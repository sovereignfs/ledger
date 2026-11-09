import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { tableNamed } from '../db/tables';
import { balanceOf, balancesOf } from './balances';
import { ensureBook } from './books';
import { findViolations } from './invariants';
import { seedAccount, seedIncomeSource, seedSubcategory } from './testing';
import { createTransaction, deleteTransaction, updateTransaction } from './transactions';
import type { TxnInput } from './validate';

const { leg } = testTarget();

let t: TwoAccounts;
let adasBook: string;
let gracesBook: string;
let bank: string;
let cash: string;
let euro: string;
let food: string;
let salary: string;
let gracesFood: string;
let gracesBank: string;
beforeAll(async () => {
  t = await twoAccounts();
  adasBook = (await ensureBook(t.database, t.ada.id)).id;
  gracesBook = (await ensureBook(t.database, t.grace.id)).id;
  bank = await seedAccount(t.database, adasBook, 'USD');
  cash = await seedAccount(t.database, adasBook, 'USD', 'cash');
  euro = await seedAccount(t.database, adasBook, 'EUR');
  food = await seedSubcategory(t.database, adasBook);
  salary = await seedIncomeSource(t.database, adasBook);
  gracesBank = await seedAccount(t.database, gracesBook, 'USD');
  gracesFood = await seedSubcategory(t.database, gracesBook);
});
afterAll(async () => t.close());

const expense = (amount: number, over: Partial<TxnInput> = {}): TxnInput => ({
  type: 'expense',
  date: '2026-11-06',
  lines: [
    { account: bank, amount: -amount, currency: 'USD' },
    { subcategory: food, amount, currency: 'USD' },
  ],
  ...over,
});
const ada = (input: TxnInput) => createTransaction(t.database, t.ada.id, adasBook, input);
const lines = (txnId: string) =>
  dbAll<{
    account: string | null;
    sub: string | null;
    amount: number | string;
    position: number | string;
  }>(
    t.database,
    sql`SELECT account_id AS account, subcategory_id AS sub, amount AS amount, position AS position
          FROM ${tableNamed(t.database, 'txn_line')} WHERE txn_id = ${txnId} ORDER BY position`,
  );
const rowCount = async (table: string) =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, table)}`,
      )
    )[0]?.n,
  );

describe(`writing a transaction (${leg})`, () => {
  it('writes an expense and its lines, in order, and the account’s balance is the sum', async () => {
    const result = await ada(expense(2500, { note: '  lunch  ' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (await lines(result.id)).map((l) => [
        Number(l.amount),
        l.account === bank,
        Number(l.position),
      ]),
    ).toEqual([
      [-2500, true, 0],
      [2500, false, 1],
    ]);
    const row = (
      await dbAll<{ note: string; status: string; createdBy: string }>(
        t.database,
        sql`SELECT note AS note, status AS status, created_by AS "createdBy" FROM ${tableNamed(t.database, 'txn')} WHERE id = ${result.id}`,
      )
    )[0];
    expect(row).toEqual({ note: 'lunch', status: 'pending', createdBy: t.ada.id });
    expect(await balanceOf(t.database, t.ada.id, adasBook, bank)).toBe(-2500);
  });

  it('writes each of the types', async () => {
    const before = await balanceOf(t.database, t.ada.id, adasBook, bank);
    const done = async (input: TxnInput) => expect((await ada(input)).ok, input.type).toBe(true);
    await done({
      type: 'opening',
      date: '2026-01-01',
      lines: [
        { account: bank, amount: 100000, currency: 'USD' },
        { equity: 'opening', amount: -100000, currency: 'USD' },
      ],
    });
    await done({
      type: 'income',
      date: '2026-11-01',
      lines: [
        { account: bank, amount: 300000, currency: 'USD' },
        { incomeSource: salary, amount: -300000, currency: 'USD' },
      ],
    });
    await done({
      type: 'transfer',
      date: '2026-11-02',
      lines: [
        { account: bank, amount: -5000, currency: 'USD' },
        { account: cash, amount: 5000, currency: 'USD' },
      ],
    });
    await done({
      type: 'transfer',
      date: '2026-11-03',
      lines: [
        { account: bank, amount: -10000, currency: 'USD' },
        { account: euro, amount: 9000, currency: 'EUR' },
      ],
    });
    await done({
      type: 'adjustment',
      date: '2026-11-04',
      lines: [
        { account: cash, amount: -150, currency: 'USD' },
        { equity: 'adjustment', amount: 150, currency: 'USD' },
      ],
    });
    expect(await balanceOf(t.database, t.ada.id, adasBook, bank)).toBe(
      before + 100000 + 300000 - 5000 - 10000,
    );
    expect(await balanceOf(t.database, t.ada.id, adasBook, cash)).toBe(5000 - 150);
    expect(await balanceOf(t.database, t.ada.id, adasBook, euro)).toBe(9000);
    expect(await findViolations(t.database, adasBook)).toEqual([]);
  });

  it('keeps an opening and an adjustment cleared and the others pending, unless told', async () => {
    const statusOf = async (id: string) =>
      (
        await dbAll<{ s: string }>(
          t.database,
          sql`SELECT status AS s FROM ${tableNamed(t.database, 'txn')} WHERE id = ${id}`,
        )
      )[0]?.s;
    const opening = await ada({
      type: 'opening',
      date: '2026-01-02',
      lines: [
        { account: cash, amount: 1, currency: 'USD' },
        { equity: 'opening', amount: -1, currency: 'USD' },
      ],
    });
    const cleared = await ada(expense(100, { status: 'cleared' }));
    if (!opening.ok || !cleared.ok) throw new Error('not written');
    expect(await statusOf(opening.id)).toBe('cleared');
    expect(await statusOf(cleared.id)).toBe('cleared');
  });

  it('refuses a transaction whose lines do not add up, with a sentence, and writes nothing', async () => {
    const before = [await rowCount('txn'), await rowCount('txn_line')];
    const result = await ada({
      ...expense(2500),
      lines: [
        { account: bank, amount: -2500, currency: 'USD' },
        { subcategory: food, amount: 2400, currency: 'USD' },
      ],
    });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      problems: [
        'The lines add up to -1.00 USD, and they must add up to nothing: what comes out of one place goes into another.',
      ],
    });
    expect([await rowCount('txn'), await rowCount('txn_line')]).toEqual(before);
  });

  it('refuses an account line in the wrong currency, and an expense paid by a second kind of account, from what the accounts are', async () => {
    const wrong = await ada({
      ...expense(100),
      lines: [
        { account: euro, amount: -100, currency: 'USD' },
        { subcategory: food, amount: 100, currency: 'USD' },
      ],
    });
    expect(wrong).toMatchObject({ ok: false, reason: 'invalid' });
    const second = await ada({
      ...expense(100),
      lines: [
        { account: bank, amount: -100, currency: 'USD' },
        { account: cash, amount: 50, currency: 'USD' },
        { subcategory: food, amount: 50, currency: 'USD' },
      ],
    });
    expect(second).toMatchObject({
      ok: false,
      problems: [expect.stringContaining('loan or a credit card')],
    });
  });

  it('writes a loan instalment as one expense: the bank down, the loan up, the interest up', async () => {
    const loan = await seedAccount(t.database, adasBook, 'USD', 'loan');
    const interest = await seedSubcategory(t.database, adasBook);
    const result = await ada({
      type: 'expense',
      date: '2026-11-05',
      lines: [
        { account: bank, amount: -10000, currency: 'USD' },
        { account: loan, amount: 9000, currency: 'USD' },
        { subcategory: interest, amount: 1000, currency: 'USD' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(await balanceOf(t.database, t.ada.id, adasBook, loan)).toBe(9000);
  });

  it('gives a new value only to an investment or a property', async () => {
    const fund = await seedAccount(t.database, adasBook, 'USD', 'investment');
    const value = (account: string) =>
      ada({
        type: 'revaluation',
        date: '2026-11-06',
        lines: [
          { account, amount: 700, currency: 'USD' },
          { equity: 'revaluation', amount: -700, currency: 'USD' },
        ],
      });
    expect((await value(fund)).ok).toBe(true);
    expect(await value(bank)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe(`what a line points at is the book's (${leg})`, () => {
  it('reads another person’s subcategory, account and income source as not found, and writes nothing', async () => {
    const graceIncome = await seedIncomeSource(t.database, gracesBook);
    const before = [await rowCount('txn'), await rowCount('txn_line')];
    const cases: TxnInput[] = [
      {
        ...expense(100),
        lines: [
          { account: bank, amount: -100, currency: 'USD' },
          { subcategory: gracesFood, amount: 100, currency: 'USD' },
        ],
      },
      {
        ...expense(100),
        lines: [
          { account: gracesBank, amount: -100, currency: 'USD' },
          { subcategory: food, amount: 100, currency: 'USD' },
        ],
      },
      {
        type: 'income',
        date: '2026-11-06',
        lines: [
          { account: bank, amount: 100, currency: 'USD' },
          { incomeSource: graceIncome, amount: -100, currency: 'USD' },
        ],
      },
      {
        type: 'transfer',
        date: '2026-11-06',
        lines: [
          { account: bank, amount: -100, currency: 'USD' },
          { account: gracesBank, amount: 100, currency: 'USD' },
        ],
      },
      {
        ...expense(100),
        lines: [
          { account: bank, amount: -100, currency: 'USD' },
          { subcategory: crypto.randomUUID(), amount: 100, currency: 'USD' },
        ],
      },
    ];
    for (const input of cases) expect(await ada(input)).toEqual({ ok: false, reason: 'not_found' });
    expect([await rowCount('txn'), await rowCount('txn_line')]).toEqual(before);
  });

  it('is the same answer for a book that is not the account’s', async () => {
    expect(await createTransaction(t.database, t.grace.id, adasBook, expense(100))).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await createTransaction(t.database, t.ada.id, gracesBook, expense(100))).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('says what is wrong with the input alone, whoever asks: a sentence reveals nothing of the book', async () => {
    const bad = await createTransaction(t.database, t.grace.id, adasBook, {
      ...expense(100),
      lines: [
        { account: bank, amount: -100, currency: 'USD' },
        { subcategory: food, amount: 99, currency: 'USD' },
      ],
    });
    // The sum is wrong whoever asks: that is said of the input alone, and reveals nothing of Ada’s book.
    expect(bad).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe(`editing and deleting (${leg})`, () => {
  it('replaces the lines with the entry, in one transaction', async () => {
    const made = await ada(expense(1000));
    if (!made.ok) throw new Error('not written');
    const edited = await updateTransaction(t.database, t.ada.id, adasBook, made.id, {
      type: 'expense',
      date: '2026-11-07',
      lines: [
        { account: bank, amount: -1500, currency: 'USD' },
        { subcategory: food, amount: 900, currency: 'USD' },
        { subcategory: food, amount: 600, currency: 'USD' },
      ],
      note: 'split',
    });
    expect(edited).toEqual({ ok: true, id: made.id });
    expect((await lines(made.id)).map((l) => Number(l.amount))).toEqual([-1500, 900, 600]);
    expect(await findViolations(t.database, adasBook)).toEqual([]);
  });

  it('keeps who made it, and its status unless one is given', async () => {
    const made = await ada(expense(100, { status: 'cleared' }));
    if (!made.ok) throw new Error('not written');
    await updateTransaction(t.database, t.ada.id, adasBook, made.id, expense(200));
    const row = (
      await dbAll<{
        status: string;
        by: string;
        created: number | string;
        updated: number | string;
      }>(
        t.database,
        sql`SELECT status AS status, created_by AS by, created_at AS created, updated_at AS updated FROM ${tableNamed(t.database, 'txn')} WHERE id = ${made.id}`,
      )
    )[0];
    expect(row?.status).toBe('cleared');
    expect(row?.by).toBe(t.ada.id);
    expect(Number(row?.updated)).toBeGreaterThanOrEqual(Number(row?.created));
  });

  it('leaves the entry as it was when an edit is refused, wherever it is refused', async () => {
    const made = await ada(expense(1000));
    if (!made.ok) throw new Error('not written');
    const before = (await lines(made.id)).map((l) => Number(l.amount));
    const bad = await updateTransaction(t.database, t.ada.id, adasBook, made.id, {
      ...expense(1000),
      lines: [
        { account: bank, amount: -1000, currency: 'USD' },
        { subcategory: food, amount: 999, currency: 'USD' },
      ],
    });
    expect(bad).toMatchObject({ ok: false, reason: 'invalid' });
    const foreign = await updateTransaction(t.database, t.ada.id, adasBook, made.id, {
      ...expense(1000),
      date: '2026-12-31',
      note: 'must not stay',
      lines: [
        { account: bank, amount: -1000, currency: 'USD' },
        { subcategory: gracesFood, amount: 1000, currency: 'USD' },
      ],
    });
    expect(foreign).toEqual({ ok: false, reason: 'not_found' });
    expect((await lines(made.id)).map((l) => Number(l.amount))).toEqual(before);
    // Its own row was written first, under the permission, and went back with the refusal.
    const row = (
      await dbAll<{ date: string; note: string | null }>(
        t.database,
        sql`SELECT date AS date, note AS note FROM ${tableNamed(t.database, 'txn')} WHERE id = ${made.id}`,
      )
    )[0];
    expect(row).toEqual({ date: '2026-11-06', note: null });
  });

  it('is not another person’s to edit or delete: it reads as not found, and nothing changes', async () => {
    const made = await ada(expense(1000));
    if (!made.ok) throw new Error('not written');
    expect(await updateTransaction(t.database, t.grace.id, adasBook, made.id, expense(5))).toEqual({
      ok: false,
      reason: 'not_found',
    });
    // Even from her own book, with the id of Ada's entry, and with lines that are hers.
    const hers = {
      ...expense(5),
      lines: [
        { account: gracesBank, amount: -5, currency: 'USD' },
        { subcategory: gracesFood, amount: 5, currency: 'USD' },
      ],
    };
    expect(await updateTransaction(t.database, t.grace.id, gracesBook, made.id, hers)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await deleteTransaction(t.database, t.grace.id, adasBook, made.id)).toBe(false);
    expect(await deleteTransaction(t.database, t.grace.id, gracesBook, made.id)).toBe(false);
    expect((await lines(made.id)).map((l) => Number(l.amount))).toEqual([-1000, 1000]);
    expect(
      await updateTransaction(t.database, t.ada.id, adasBook, crypto.randomUUID(), expense(5)),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('deletes an entry and its lines together, and a repeat finds nothing', async () => {
    const made = await ada(expense(1000));
    if (!made.ok) throw new Error('not written');
    expect(await deleteTransaction(t.database, t.ada.id, adasBook, made.id)).toBe(true);
    expect(await lines(made.id)).toEqual([]);
    expect(await deleteTransaction(t.database, t.ada.id, adasBook, made.id)).toBe(false);
    expect(await findViolations(t.database, adasBook)).toEqual([]);
  });
});

describe(`balances (${leg})`, () => {
  it('are the sum of the lines up to a date, and another person has none of them', async () => {
    const account = await seedAccount(t.database, adasBook, 'USD', 'savings');
    const put = (date: string, amount: number) =>
      ada({
        type: 'adjustment',
        date,
        lines: [
          { account, amount, currency: 'USD' },
          { equity: 'adjustment', amount: -amount, currency: 'USD' },
        ],
      });
    await put('2026-03-01', 1000);
    await put('2026-06-01', 250);
    await put('2026-09-01', -400);
    expect(await balanceOf(t.database, t.ada.id, adasBook, account)).toBe(850);
    expect(await balanceOf(t.database, t.ada.id, adasBook, account, '2026-06-01')).toBe(1250);
    expect(await balanceOf(t.database, t.ada.id, adasBook, account, '2026-05-31')).toBe(1000);
    expect(await balanceOf(t.database, t.ada.id, adasBook, account, '2026-02-28')).toBe(0);
    expect(await balanceOf(t.database, t.grace.id, adasBook, account)).toBe(0);
    expect((await balancesOf(t.database, t.grace.id, adasBook)).size).toBe(0);
    await expect(balancesOf(t.database, t.ada.id, adasBook, '2026-02-30')).rejects.toThrow(
      RangeError,
    );
  });
});
