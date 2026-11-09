import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { listAccounts } from '../ledger/accounts';
import { type Book, ensureBook, findBook } from '../ledger/books';
import { listCategories } from '../budget/categories';
import { listIncomeSources } from '../budget/income-sources';
import { budgetsForMonth } from '../budget/amounts';
import { monthOf, todayIn } from '../dates';
import {
  finishSetup,
  loadSetup,
  setupAccount,
  setupCategories,
  setupCurrency,
  setupIncome,
} from './setup';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
});
afterAll(async () => t.close());

const book = async (person = t.ada) => (await findBook(t.database, person.id)) as Book;
const state = async () => loadSetup(t.database, t.ada.id, await book());
const count = async (table: string, id = adas) =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, table)} WHERE book_id = ${id}`,
      )
    )[0]?.n,
  );

describe(`setting up a book (${leg})`, () => {
  it('starts at the currency, and each step moves it on to the next, which is read from the book and not remembered', async () => {
    expect(await state()).toMatchObject({
      done: false,
      baseCurrency: null,
      account: null,
      income: null,
      subcategories: 0,
      step: 1,
    });
    const one = await setupCurrency(t.database, t.ada.id, adas, {
      currency: 'EUR',
      timeZone: 'Europe/Berlin',
    });
    expect(one).toMatchObject({
      ok: true,
      state: { baseCurrency: 'EUR', timeZone: 'Europe/Berlin', step: 2 },
    });
    const two = await setupAccount(t.database, t.ada.id, adas, {
      type: 'bank',
      name: 'Everyday',
      balance: 123_456,
      date: '2026-11-09',
    });
    expect(two).toMatchObject({
      ok: true,
      state: {
        account: { name: 'Everyday', type: 'bank', currency: 'EUR', balance: 123_456 },
        step: 3,
      },
    });
    const three = await setupIncome(t.database, t.ada.id, adas, {
      name: 'Salary',
      amount: 300_000,
    });
    expect(three).toMatchObject({
      ok: true,
      state: { income: { name: 'Salary', budgeted: 300_000 }, step: 4 },
    });
    const four = await setupCategories(t.database, t.ada.id, adas, [
      { name: 'Groceries', amount: 40_000 },
      { name: 'Transport', amount: null },
    ]);
    expect(four).toMatchObject({ ok: true, state: { subcategories: 2 } });
    expect(await finishSetup(t.database, t.ada.id, adas)).toMatchObject({
      ok: true,
      state: { done: true },
    });
    // What was written is the real thing: the account has its opening balance, the categories their budgets.
    const accounts = await listAccounts(t.database, t.ada.id, adas);
    expect(accounts.map((a) => [a.name, a.currency, a.balance])).toEqual([
      ['Everyday', 'EUR', 123_456],
    ]);
    const groceries = (await listCategories(t.database, t.ada.id, adas)).find(
      (c) => c.name === 'Groceries',
    );
    expect(groceries).toMatchObject({ currency: 'EUR', subcategories: [{ name: 'Groceries' }] });
    const budgets = await budgetsForMonth(
      t.database,
      t.ada.id,
      adas,
      monthOf(todayIn('Europe/Berlin')),
    );
    expect(budgets.get(`subcategory:${groceries?.subcategories[0]?.id}`)).toBe(40_000);
  });

  it('is safe to repeat, each step: going back and forward makes no duplicate, and a refresh loses nothing', async () => {
    const before = [
      await count('money_account'),
      await count('income_source'),
      await count('category'),
      await count('subcategory'),
      await count('txn'),
      await count('budget_amount'),
    ];
    for (let i = 0; i < 3; i++) {
      // Each repeat is an answer of success, not a refusal that happened to write nothing: the step finds what is there.
      const answers = [
        await setupCurrency(t.database, t.ada.id, adas, {
          currency: 'EUR',
          timeZone: 'Europe/Berlin',
        }),
        await setupAccount(t.database, t.ada.id, adas, {
          type: 'bank',
          name: 'Everyday',
          balance: 123_456,
          date: '2026-11-09',
        }),
        await setupAccount(t.database, t.ada.id, adas, {
          type: 'cash',
          name: 'A different name',
          balance: 5,
          date: '2026-11-09',
        }),
        await setupIncome(t.database, t.ada.id, adas, { name: 'Salary', amount: 300_000 }),
        await setupCategories(t.database, t.ada.id, adas, [
          { name: 'GROCERIES', amount: 40_000 },
          { name: 'Transport', amount: null },
        ]),
        await finishSetup(t.database, t.ada.id, adas),
      ];
      for (const answer of answers) expect(answer).toMatchObject({ ok: true });
    }
    expect([
      await count('money_account'),
      await count('income_source'),
      await count('category'),
      await count('subcategory'),
      await count('txn'),
      await count('budget_amount'),
    ]).toEqual(before);
    expect(await state()).toMatchObject({
      done: true,
      account: { name: 'Everyday' },
      subcategories: 2,
    });
  });

  it('renames the primary income and changes its budget this month, and the currency can be changed without re-pricing anything', async () => {
    await setupIncome(t.database, t.ada.id, adas, { name: 'Pay', amount: 310_000 });
    expect(
      (await listIncomeSources(t.database, t.ada.id, adas)).map((s) => [s.name, s.kind]),
    ).toEqual([['Pay', 'primary']]);
    expect((await state()).income).toMatchObject({ name: 'Pay', budgeted: 310_000 });
    await setupCurrency(t.database, t.ada.id, adas, { currency: 'USD' });
    expect(await state()).toMatchObject({ baseCurrency: 'USD', timeZone: 'Europe/Berlin' });
    expect((await listAccounts(t.database, t.ada.id, adas))[0]).toMatchObject({
      currency: 'EUR',
      balance: 123_456,
    });
    await setupCurrency(t.database, t.ada.id, adas, { currency: 'EUR' });
  });

  it('makes nothing that was not chosen: no categories for none', async () => {
    const before = [await count('category'), await count('subcategory')];
    expect(await setupCategories(t.database, t.ada.id, adas, [])).toMatchObject({ ok: true });
    expect([await count('category'), await count('subcategory')]).toEqual(before);
  });

  it('keeps the time of finishing: it is set once and a repeat does not move it', async () => {
    const first = (await book()).setupDoneAt;
    expect(first).not.toBeNull();
    await finishSetup(t.database, t.ada.id, adas, 1);
    expect((await book()).setupDoneAt).toBe(first);
  });
});

describe(`what setup refuses (${leg})`, () => {
  it('asks for the currency first, and refuses what is not a currency, a time zone, an amount or a name, writing nothing', async () => {
    const fresh = crypto.randomUUID();
    const freshBook = (await ensureBook(t.database, fresh)).id;
    expect(
      await setupAccount(t.database, fresh, freshBook, {
        type: 'bank',
        name: 'X',
        balance: 1,
        date: '2026-11-09',
      }),
    ).toEqual({ ok: false, reason: 'invalid', problems: ['Choose the currency first.'] });
    expect(await setupIncome(t.database, fresh, freshBook, { name: 'X', amount: 1 })).toMatchObject(
      { ok: false, reason: 'invalid' },
    );
    expect(
      await setupCategories(t.database, fresh, freshBook, [{ name: 'X', amount: 1 }]),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    for (const input of [
      { currency: 'BTC' },
      { currency: '' },
      { currency: 'EUR', timeZone: 'Not/AZone' },
      { currency: 5 as never },
    ])
      expect(
        await setupCurrency(t.database, fresh, freshBook, input),
        JSON.stringify(input),
      ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      (await loadSetup(t.database, fresh, (await findBook(t.database, fresh)) as Book))
        .baseCurrency,
    ).toBeNull();
    await setupCurrency(t.database, fresh, freshBook, { currency: 'USD' });
    expect(
      await setupAccount(t.database, fresh, freshBook, {
        type: 'credit_card',
        name: 'X',
        balance: 1,
        date: '2026-11-09',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      await setupAccount(t.database, fresh, freshBook, {
        type: 'bank',
        name: '',
        balance: 1,
        date: '2026-11-09',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      await setupIncome(t.database, fresh, freshBook, { name: 'Pay', amount: -1 }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      await setupCategories(
        t.database,
        fresh,
        freshBook,
        Array.from({ length: 21 }, (_, i) => ({ name: `C${i}`, amount: null })),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await count('money_account', freshBook)).toBe(0);
    expect(await count('category', freshBook)).toBe(0);
  });
});

describe(`another person’s setup (${leg})`, () => {
  it('is not theirs: each step answers as for a book that is not there, and nothing of Ada’s changes', async () => {
    const before = JSON.stringify(await state());
    expect(await setupCurrency(t.database, t.grace.id, adas, { currency: 'JPY' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(
      await setupAccount(t.database, t.grace.id, adas, {
        type: 'bank',
        name: 'X',
        balance: 1,
        date: '2026-11-09',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await setupIncome(t.database, t.grace.id, adas, { name: 'X', amount: 1 })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(
      await setupCategories(t.database, t.grace.id, adas, [{ name: 'X', amount: null }]),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await finishSetup(t.database, t.grace.id, adas)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(JSON.stringify(await state())).toBe(before);
    expect(graces).not.toBe(adas);
    expect((await book(t.grace)).baseCurrency).toBeNull();
  });
});
