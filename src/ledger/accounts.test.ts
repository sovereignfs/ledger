import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import {
  createAccount,
  deleteAccount,
  entriesOf,
  getAccount,
  listAccounts,
  setArchived,
  updateAccount,
} from './accounts';
import type { NewAccount } from './account-types';
import { balanceOf } from './balances';
import { ensureBook } from './books';
import { listCurrencies } from './currencies';
import { findViolations } from './invariants';
import { seedSubcategory } from './testing';
import { createTransaction } from './transactions';

const { leg } = testTarget();

let t: TwoAccounts;
let adasBook: string;
let gracesBook: string;
beforeAll(async () => {
  t = await twoAccounts();
  adasBook = (await ensureBook(t.database, t.ada.id)).id;
  gracesBook = (await ensureBook(t.database, t.grace.id)).id;
});
afterAll(async () => t.close());

const make = (input: Partial<NewAccount> & Pick<NewAccount, 'type' | 'name'>) =>
  createAccount(t.database, t.ada.id, adasBook, { currency: 'USD', ...input });
const idOf = async (input: Parameters<typeof make>[0]) => {
  const result = await make(input);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
};
const count = async (table: string, where = sql`1 = 1`) =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, table)} WHERE ${where}`,
      )
    )[0]?.n,
  );

describe(`making an account (${leg})`, () => {
  it('writes the account, adds its currency to the book, and gives it the balance it was opened with, as an opening entry', async () => {
    const id = await idOf({
      type: 'bank',
      name: '  Everyday  ',
      institution: 'First Bank',
      currency: 'EUR',
      opening: { amount: 123456, date: '2026-01-01' },
    });
    const account = await getAccount(t.database, t.ada.id, adasBook, id);
    expect(account).toMatchObject({
      type: 'bank',
      name: 'Everyday',
      institution: 'First Bank',
      currency: 'EUR',
      balance: 123456,
      archivedAt: null,
      loan: null,
      deletable: true,
    });
    expect(await listCurrencies(t.database, t.ada.id, adasBook)).toContain('EUR');
    const entries = await entriesOf(t.database, t.ada.id, adasBook, id);
    expect(entries).toEqual([
      expect.objectContaining({
        type: 'opening',
        status: 'cleared',
        amount: 123456,
        currency: 'EUR',
        date: '2026-01-01',
      }),
    ]);
    expect(await findViolations(t.database, adasBook)).toEqual([]);
  });

  it('writes no opening entry for an account that starts empty, and puts accounts in the order they were made', async () => {
    const a = await idOf({ type: 'cash', name: 'Wallet' });
    const b = await idOf({ type: 'cash', name: 'Jar', opening: { amount: 0, date: '2026-01-01' } });
    expect(await entriesOf(t.database, t.ada.id, adasBook, a)).toEqual([]);
    expect(await entriesOf(t.database, t.ada.id, adasBook, b)).toEqual([]);
    const names = (await listAccounts(t.database, t.ada.id, adasBook)).map((row) => row.name);
    expect(names.indexOf('Wallet')).toBeLessThan(names.indexOf('Jar'));
  });

  it('opens a card and a loan below nothing, because that is what is owed, and keeps their terms', async () => {
    const card = await idOf({
      type: 'credit_card',
      name: 'Card',
      creditLimit: 500000,
      opening: { amount: -42000, date: '2026-02-01' },
    });
    expect(await getAccount(t.database, t.ada.id, adasBook, card)).toMatchObject({
      creditLimit: 500000,
      balance: -42000,
    });
    const interest = await seedSubcategory(t.database, adasBook);
    const loan = await idOf({
      type: 'loan',
      name: 'Car loan',
      opening: { amount: -1000000, date: '2026-01-01' },
      loan: {
        lender: 'Credit Union',
        principal: 1000000,
        startDate: '2026-01-01',
        endDate: '2029-01-01',
        instalment: 30000,
        yearlyRate: '4.25',
        interestSubcategoryId: interest,
      },
    });
    expect(await getAccount(t.database, t.ada.id, adasBook, loan)).toMatchObject({
      balance: -1000000,
      loan: {
        lender: 'Credit Union',
        principal: 1000000,
        endDate: '2029-01-01',
        instalment: 30000,
        yearlyRate: '4.25',
        interestSubcategoryId: interest,
      },
    });
  });

  it('refuses with sentences, and writes nothing, for what is not allowed', async () => {
    const before = [await count('money_account'), await count('txn'), await count('loan')];
    const cases: [Parameters<typeof make>[0], string][] = [
      [{ type: 'bank', name: '   ' }, 'needs a name'],
      [{ type: 'bank', name: 'x'.repeat(81) }, 'at most 80'],
      [{ type: 'bank', name: 'Bad', currency: 'BTC' }, 'currency is not one'],
      [{ type: 'bank', name: 'Bad', creditLimit: 100 }, 'Only a credit card has a limit'],
      [{ type: 'credit_card', name: 'Bad', creditLimit: 0 }, 'more than nothing'],
      [
        { type: 'bank', name: 'Bad', opening: { amount: 1.5, date: '2026-01-01' } },
        'not an amount',
      ],
      [
        { type: 'bank', name: 'Bad', opening: { amount: 5, date: '2026-02-30' } },
        'the day it is of',
      ],
      [{ type: 'loan', name: 'Bad' }, 'needs its lender'],
      [
        {
          type: 'bank',
          name: 'Bad',
          loan: {
            lender: 'x',
            principal: 1,
            startDate: '2026-01-01',
            endDate: '2027-01-01',
            instalment: 1,
            yearlyRate: null,
            interestSubcategoryId: null,
          },
        },
        'Only a loan',
      ],
      [{ type: 'purse' as never, name: 'Bad' }, 'not one there is'],
      [
        {
          type: 'loan',
          name: 'Bad',
          loan: {
            lender: 'x',
            principal: 100,
            startDate: '2026-06-01',
            endDate: '2026-01-01',
            instalment: 10,
            yearlyRate: '4',
            interestSubcategoryId: null,
          },
        },
        'does not end before it starts',
      ],
      [
        {
          type: 'loan',
          name: 'Bad',
          loan: {
            lender: 'x',
            principal: 100,
            startDate: '2026-01-01',
            endDate: '2027-01-01',
            instalment: 10,
            yearlyRate: '4,5',
            interestSubcategoryId: null,
          },
        },
        'yearly rate',
      ],
    ];
    for (const [input, fragment] of cases) {
      const result = await make(input);
      expect(result, fragment).toMatchObject({ ok: false, reason: 'invalid' });
      expect(JSON.stringify(result), fragment).toContain(fragment);
    }
    expect([await count('money_account'), await count('txn'), await count('loan')]).toEqual(before);
  });

  it('writes nothing at all when a part of it is refused: an interest subcategory that is another person’s', async () => {
    const graces = await seedSubcategory(t.database, gracesBook);
    const before = [
      await count('money_account'),
      await count('txn'),
      await count('txn_line'),
      await count('loan'),
    ];
    const result = await make({
      type: 'loan',
      name: 'Sneaky',
      opening: { amount: -500, date: '2026-01-01' },
      loan: {
        lender: 'x',
        principal: 500,
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        instalment: 50,
        yearlyRate: null,
        interestSubcategoryId: graces,
      },
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect([
      await count('money_account'),
      await count('txn'),
      await count('txn_line'),
      await count('loan'),
    ]).toEqual(before);
  });
});

describe(`changing an account (${leg})`, () => {
  it('changes its name and institution, a card’s limit and a loan’s changeable terms, and nothing else', async () => {
    const card = await idOf({
      type: 'credit_card',
      name: 'Old',
      creditLimit: 1000,
      currency: 'GBP',
    });
    expect(
      await updateAccount(t.database, t.ada.id, adasBook, card, {
        name: ' New ',
        institution: 'Bank',
        creditLimit: 2000,
      }),
    ).toEqual({ ok: true, id: card });
    expect(await getAccount(t.database, t.ada.id, adasBook, card)).toMatchObject({
      name: 'New',
      institution: 'Bank',
      creditLimit: 2000,
      currency: 'GBP',
      type: 'credit_card',
    });
    const loan = await idOf({
      type: 'loan',
      name: 'Loan',
      loan: {
        lender: 'A',
        principal: 1000,
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        instalment: 100,
        yearlyRate: null,
        interestSubcategoryId: null,
      },
    });
    await updateAccount(t.database, t.ada.id, adasBook, loan, {
      loan: { lender: 'B', endDate: '2028-01-01', instalment: 80, yearlyRate: '3.5' },
    });
    expect((await getAccount(t.database, t.ada.id, adasBook, loan))?.loan).toMatchObject({
      lender: 'B',
      principal: 1000,
      startDate: '2026-01-01',
      endDate: '2028-01-01',
      instalment: 80,
      yearlyRate: '3.5',
    });
  });

  it('refuses what its kind does not have, or a loan that would end before it began', async () => {
    const bank = await idOf({ type: 'bank', name: 'Plain' });
    expect(
      await updateAccount(t.database, t.ada.id, adasBook, bank, { creditLimit: 100 }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      await updateAccount(t.database, t.ada.id, adasBook, bank, { loan: { lender: 'x' } }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await updateAccount(t.database, t.ada.id, adasBook, bank, { name: '' })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    const loan = await idOf({
      type: 'loan',
      name: 'L',
      loan: {
        lender: 'A',
        principal: 1000,
        startDate: '2026-06-01',
        endDate: '2027-01-01',
        instalment: 100,
        yearlyRate: null,
        interestSubcategoryId: null,
      },
    });
    expect(
      await updateAccount(t.database, t.ada.id, adasBook, loan, {
        loan: { endDate: '2026-01-01' },
      }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect((await getAccount(t.database, t.ada.id, adasBook, loan))?.loan?.endDate).toBe(
      '2027-01-01',
    );
  });

  it('archives and brings back, keeping the history and the balance', async () => {
    const id = await idOf({
      type: 'savings',
      name: 'Old savings',
      opening: { amount: 5000, date: '2026-01-01' },
    });
    expect(await setArchived(t.database, t.ada.id, adasBook, id, true)).toBe(true);
    expect((await listAccounts(t.database, t.ada.id, adasBook)).map((a) => a.id)).not.toContain(id);
    const archived = await listAccounts(t.database, t.ada.id, adasBook, { archived: true });
    expect(archived.find((a) => a.id === id)).toMatchObject({ balance: 5000 });
    expect(await getAccount(t.database, t.ada.id, adasBook, id)).toMatchObject({ balance: 5000 });
    expect(await balanceOf(t.database, t.ada.id, adasBook, id)).toBe(5000);
    expect(await setArchived(t.database, t.ada.id, adasBook, id, true)).toBe(true);
    expect(await setArchived(t.database, t.ada.id, adasBook, id, false)).toBe(true);
    expect((await listAccounts(t.database, t.ada.id, adasBook)).map((a) => a.id)).toContain(id);
  });
});

describe(`deleting an account (${leg})`, () => {
  it('deletes one that has nothing but its opening balance, with that balance and a loan’s terms', async () => {
    const id = await idOf({
      type: 'loan',
      name: 'Mistake',
      opening: { amount: -9900, date: '2026-01-01' },
      loan: {
        lender: 'x',
        principal: 9900,
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        instalment: 900,
        yearlyRate: null,
        interestSubcategoryId: null,
      },
    });
    const lines = () => count('txn_line', sql`account_id = ${id}`);
    expect(await lines()).toBe(1);
    expect((await getAccount(t.database, t.ada.id, adasBook, id))?.deletable).toBe(true);
    expect(await deleteAccount(t.database, t.ada.id, adasBook, id)).toBe('deleted');
    expect(await getAccount(t.database, t.ada.id, adasBook, id)).toBeUndefined();
    expect(await lines()).toBe(0);
    expect(await count('loan', sql`account_id = ${id}`)).toBe(0);
    expect(await findViolations(t.database, adasBook)).toEqual([]);
    expect(await deleteAccount(t.database, t.ada.id, adasBook, id)).toBe('not_found');
  });

  it('refuses one that has been used, and leaves everything; archiving is what is offered', async () => {
    const id = await idOf({
      type: 'bank',
      name: 'Used',
      opening: { amount: 10000, date: '2026-01-01' },
    });
    const other = await idOf({ type: 'cash', name: 'Other' });
    const moved = await createTransaction(t.database, t.ada.id, adasBook, {
      type: 'transfer',
      date: '2026-02-01',
      lines: [
        { account: id, amount: -100, currency: 'USD' },
        { account: other, amount: 100, currency: 'USD' },
      ],
    });
    expect(moved.ok).toBe(true);
    expect((await getAccount(t.database, t.ada.id, adasBook, id))?.deletable).toBe(false);
    expect(await deleteAccount(t.database, t.ada.id, adasBook, id)).toBe('has_entries');
    expect(await balanceOf(t.database, t.ada.id, adasBook, id)).toBe(9900);
    await setArchived(t.database, t.ada.id, adasBook, id, true);
    expect(await balanceOf(t.database, t.ada.id, adasBook, id)).toBe(9900);
    // The other account, with an entry of its own, cannot be deleted either: it has a transfer.
    expect(await deleteAccount(t.database, t.ada.id, adasBook, other)).toBe('has_entries');
  });
});

describe(`the entries of an account (${leg})`, () => {
  it('are newest first, each with its line on this account, and in pages', async () => {
    const a = await idOf({ type: 'bank', name: 'Entries A' });
    const b = await idOf({ type: 'cash', name: 'Entries B' });
    for (const [date, amount] of [
      ['2026-03-01', 100],
      ['2026-05-01', 200],
      ['2026-04-01', 300],
    ] as const)
      await createTransaction(t.database, t.ada.id, adasBook, {
        type: 'transfer',
        date,
        lines: [
          { account: a, amount: -amount, currency: 'USD' },
          { account: b, amount, currency: 'USD' },
        ],
      });
    const rows = await entriesOf(t.database, t.ada.id, adasBook, a);
    expect(rows.map((r) => [r.date, r.amount])).toEqual([
      ['2026-05-01', -200],
      ['2026-04-01', -300],
      ['2026-03-01', -100],
    ]);
    expect((await entriesOf(t.database, t.ada.id, adasBook, b)).map((r) => r.amount)).toEqual([
      200, 300, 100,
    ]);
    expect(
      (await entriesOf(t.database, t.ada.id, adasBook, a, { limit: 1, offset: 1 })).map(
        (r) => r.date,
      ),
    ).toEqual(['2026-04-01']);
  });
});

describe(`another person’s accounts (${leg})`, () => {
  it('are not there: nothing is listed, found, changed, archived, deleted or made in their book', async () => {
    const mine = await idOf({
      type: 'bank',
      name: 'Mine',
      opening: { amount: 777, date: '2026-01-01' },
    });
    const before = [await count('money_account'), await count('txn')];
    expect(await listAccounts(t.database, t.grace.id, adasBook)).toEqual([]);
    expect(await listAccounts(t.database, t.grace.id, adasBook, { archived: true })).toEqual([]);
    expect(await getAccount(t.database, t.grace.id, adasBook, mine)).toBeUndefined();
    expect(await entriesOf(t.database, t.grace.id, adasBook, mine)).toEqual([]);
    expect(await updateAccount(t.database, t.grace.id, adasBook, mine, { name: 'Hers' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await setArchived(t.database, t.grace.id, adasBook, mine, true)).toBe(false);
    expect(await deleteAccount(t.database, t.grace.id, adasBook, mine)).toBe('not_found');
    expect(
      await createAccount(t.database, t.grace.id, adasBook, {
        type: 'bank',
        name: 'In Ada’s book',
        currency: 'USD',
        opening: { amount: 1, date: '2026-01-01' },
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    // And with her own book named but Ada’s account id.
    expect(await updateAccount(t.database, t.grace.id, gracesBook, mine, { name: 'Hers' })).toEqual(
      { ok: false, reason: 'not_found' },
    );
    expect(await deleteAccount(t.database, t.grace.id, gracesBook, mine)).toBe('not_found');
    expect([await count('money_account'), await count('txn')]).toEqual(before);
    expect(await getAccount(t.database, t.ada.id, adasBook, mine)).toMatchObject({
      name: 'Mine',
      balance: 777,
      archivedAt: null,
    });
  });
});
