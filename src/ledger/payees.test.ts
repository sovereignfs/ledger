import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { ensureBook } from './books';
import { getEntry } from './entries';
import {
  getPayee,
  listPayees,
  mergePayees,
  payeeMonths,
  renamePayee,
  setPayeeArchived,
} from './payees';
import { payeeKey, payeeName } from './payee-write';
import { seedAccount, seedIncomeSource, seedSubcategory } from './testing';
import { createTransaction, deleteTransaction, updateTransaction } from './transactions';
import type { TxnInput } from './validate';

const { leg } = testTarget();

let t: TwoAccounts;
let adasBook: string;
let gracesBook: string;
let bank: string;
let cash: string;
let food: string;
let fun: string;
let pay: string;
beforeAll(async () => {
  t = await twoAccounts();
  adasBook = (await ensureBook(t.database, t.ada.id)).id;
  gracesBook = (await ensureBook(t.database, t.grace.id)).id;
  bank = await seedAccount(t.database, adasBook, 'USD');
  cash = await seedAccount(t.database, adasBook, 'USD', 'cash');
  food = await seedSubcategory(t.database, adasBook);
  fun = await seedSubcategory(t.database, adasBook);
  pay = await seedIncomeSource(t.database, adasBook);
});
afterAll(async () => t.close());

const spend = (
  payee: string | null | undefined,
  over: Partial<TxnInput> & { amount?: number; sub?: string; from?: string } = {},
) =>
  createTransaction(t.database, t.ada.id, adasBook, {
    type: 'expense',
    date: over.date ?? '2026-11-06',
    ...(payee === undefined ? {} : { payee }),
    lines: [
      { account: over.from ?? bank, amount: -(over.amount ?? 1000), currency: 'USD' },
      { subcategory: over.sub ?? food, amount: over.amount ?? 1000, currency: 'USD' },
    ],
  });
const idOf = async (result: Awaited<ReturnType<typeof spend>>) => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
};
const payeeOf = async (txnId: string) =>
  (await getEntry(t.database, t.ada.id, adasBook, txnId))?.payee;
const names = async (options = {}) =>
  (await listPayees(t.database, t.ada.id, adasBook, options)).map((p) => p.name);
const count = async (table: string, where = sql`1 = 1`) =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, table)} WHERE ${where}`,
      )
    )[0]?.n,
  );

describe('a payee’s name', () => {
  it('is one payee in any case and spacing, and shown with the spacing made one', () => {
    expect(payeeKey('  Corner   SHOP ')).toBe('corner shop');
    expect(payeeName('  Corner   Shop ')).toBe('Corner Shop');
  });
});

describe(`payees on entries (${leg})`, () => {
  it('are made the first time a name is typed, and found again in any case, so there is one', async () => {
    const first = await idOf(await spend('Corner Shop'));
    const second = await idOf(await spend('  corner   SHOP '));
    expect((await payeeOf(first))?.id).toBe((await payeeOf(second))?.id);
    expect((await payeeOf(first))?.name).toBe('Corner Shop');
    expect((await names()).filter((n) => n.toLowerCase() === 'corner shop')).toHaveLength(1);
  });

  it('are made once however many entries make them at the same moment', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => spend('Racing Payee')));
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await names()).filter((n) => n === 'Racing Payee')).toHaveLength(1);
  });

  it('remember the last subcategory and account used with them, to be proposed next time', async () => {
    await idOf(await spend('Remembered', { sub: food, from: bank }));
    await idOf(await spend('Remembered', { sub: fun, from: cash }));
    const row = (await listPayees(t.database, t.ada.id, adasBook, { query: 'remembered' }))[0];
    expect(row).toMatchObject({ lastSubcategoryId: fun, lastAccountId: cash });
  });

  it('are not made for an entry that is refused, and an entry with no payee has none', async () => {
    const before = await count('payee');
    const refused = await createTransaction(t.database, t.ada.id, adasBook, {
      type: 'expense',
      date: '2026-11-06',
      payee: 'Never Made',
      lines: [
        { account: bank, amount: -100, currency: 'USD' },
        { subcategory: food, amount: 99, currency: 'USD' },
      ],
    });
    expect(refused).toMatchObject({ ok: false, reason: 'invalid' });
    const foreign = await createTransaction(t.database, t.ada.id, adasBook, {
      type: 'expense',
      date: '2026-11-06',
      payee: 'Never Made Either',
      lines: [
        { account: bank, amount: -100, currency: 'USD' },
        {
          subcategory: await seedSubcategory(t.database, gracesBook),
          amount: 100,
          currency: 'USD',
        },
      ],
    });
    expect(foreign).toEqual({ ok: false, reason: 'not_found' });
    expect(await count('payee')).toBe(before);
    expect(await payeeOf(await idOf(await spend(undefined)))).toBeNull();
  });

  it('refuse a name that is too long, and an income can have one too', async () => {
    expect(await spend('x'.repeat(81))).toMatchObject({
      ok: false,
      reason: 'invalid',
      problems: [expect.stringContaining('at most 80')],
    });
    const income = await createTransaction(t.database, t.ada.id, adasBook, {
      type: 'income',
      date: '2026-11-01',
      payee: 'Employer',
      lines: [
        { account: bank, amount: 5000, currency: 'USD' },
        { incomeSource: pay, amount: -5000, currency: 'USD' },
      ],
    });
    expect(income.ok).toBe(true);
  });

  it('are kept, changed or removed by an edit: not given keeps, a name changes, null removes', async () => {
    const id = await idOf(await spend('Edit Me'));
    const lines = (await getEntry(t.database, t.ada.id, adasBook, id))?.lines ?? [];
    const base = { type: 'expense' as const, date: '2026-11-06', lines };
    await updateTransaction(t.database, t.ada.id, adasBook, id, { ...base, note: 'changed' });
    expect((await payeeOf(id))?.name).toBe('Edit Me');
    await updateTransaction(t.database, t.ada.id, adasBook, id, { ...base, payee: 'Another One' });
    expect((await payeeOf(id))?.name).toBe('Another One');
    await updateTransaction(t.database, t.ada.id, adasBook, id, { ...base, payee: null });
    expect(await payeeOf(id)).toBeNull();
    expect(await deleteTransaction(t.database, t.ada.id, adasBook, id)).toBe(true);
  });
});

describe(`managing payees (${leg})`, () => {
  it('lists and finds them by part of a name, in any case, and a % or _ is only itself', async () => {
    await idOf(await spend('Fifty%Off Store'));
    await idOf(await spend('Fiftyxoff Store'));
    expect(await names({ query: 'FIFTY%' })).toEqual(['Fifty%Off Store']);
    expect(await names({ query: 'store' })).toEqual(
      expect.arrayContaining(['Fifty%Off Store', 'Fiftyxoff Store']),
    );
    expect(await names({ query: '_' })).toEqual([]);
    expect(await names({ query: 'zzz-nothing' })).toEqual([]);
  });

  it('are renamed, to a name nobody has; a taken name says to merge, and a change of case is allowed', async () => {
    const id = (await payeeOf(await idOf(await spend('Rename Source'))))?.id as string;
    await idOf(await spend('Rename Taken'));
    expect(await renamePayee(t.database, t.ada.id, adasBook, id, 'rename taken')).toEqual({
      ok: false,
      reason: 'invalid',
      problems: ['There is already a payee with that name. Merge them instead.'],
    });
    expect(await renamePayee(t.database, t.ada.id, adasBook, id, 'RENAME SOURCE')).toEqual({
      ok: true,
      id,
    });
    expect((await getPayee(t.database, t.ada.id, adasBook, id))?.name).toBe('RENAME SOURCE');
    expect(await renamePayee(t.database, t.ada.id, adasBook, id, '  ')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(await renamePayee(t.database, t.ada.id, adasBook, id, 'Brand New')).toEqual({
      ok: true,
      id,
    });
    // The new name is what is found now, and the old one is a new payee.
    const again = await payeeOf(await idOf(await spend('brand new')));
    expect(again?.id).toBe(id);
  });

  it('are merged: every entry is on the survivor, the other is gone, and a repeat finds nothing', async () => {
    const a = await idOf(await spend('Merge A', { amount: 100 }));
    const b = await idOf(await spend('Merge B', { amount: 200 }));
    const b2 = await idOf(await spend('Merge B', { amount: 300 }));
    const from = (await payeeOf(b))?.id as string;
    const into = (await payeeOf(a))?.id as string;
    expect(await mergePayees(t.database, t.ada.id, adasBook, from, into)).toBe(true);
    for (const entry of [a, b, b2]) expect((await payeeOf(entry))?.id).toBe(into);
    expect(await getPayee(t.database, t.ada.id, adasBook, from)).toBeUndefined();
    expect((await getPayee(t.database, t.ada.id, adasBook, into))?.entries).toBe(3);
    expect(await mergePayees(t.database, t.ada.id, adasBook, from, into)).toBe(false);
    expect(await mergePayees(t.database, t.ada.id, adasBook, into, into)).toBe(false);
  });

  it('are archived out of the suggestions, and typing the name brings one back', async () => {
    const id = (await payeeOf(await idOf(await spend('Archive Me'))))?.id as string;
    expect(await setPayeeArchived(t.database, t.ada.id, adasBook, id, true)).toBe(true);
    expect(await names({ query: 'archive me' })).toEqual([]);
    expect(await names({ archived: true, query: 'archive me' })).toEqual(['Archive Me']);
    expect((await payeeOf(await idOf(await spend('archive me'))))?.id).toBe(id);
    expect(await names({ query: 'archive me' })).toEqual(['Archive Me']);
  });

  it('have totals by month: spent, received, by currency', async () => {
    const shop = async (date: string, amount: number) =>
      idOf(await spend('Totals Shop', { date, amount }));
    await shop('2026-10-03', 1000);
    await shop('2026-10-20', 500);
    const refund = await idOf(
      await createTransaction(t.database, t.ada.id, adasBook, {
        type: 'expense',
        date: '2026-11-02',
        payee: 'Totals Shop',
        lines: [
          { account: bank, amount: 300, currency: 'USD' },
          { subcategory: food, amount: -300, currency: 'USD' },
        ],
      }),
    );
    const id = (await payeeOf(refund))?.id as string;
    expect(await payeeMonths(t.database, t.ada.id, adasBook, id)).toEqual([
      { month: '2026-11', currency: 'USD', spent: -300, received: 0, entries: 1 },
      { month: '2026-10', currency: 'USD', spent: 1500, received: 0, entries: 2 },
    ]);
  });
});

describe(`another person’s payees (${leg})`, () => {
  it('are not there: nothing is listed, found, renamed, archived, merged or totalled, and a name typed in their book is theirs', async () => {
    const mine = (await payeeOf(await idOf(await spend('Ada Private'))))?.id as string;
    const other = (await payeeOf(await idOf(await spend('Ada Other'))))?.id as string;
    expect(await listPayees(t.database, t.grace.id, adasBook)).toEqual([]);
    expect(await getPayee(t.database, t.grace.id, adasBook, mine)).toBeUndefined();
    expect(await renamePayee(t.database, t.grace.id, adasBook, mine, 'Hers')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await setPayeeArchived(t.database, t.grace.id, adasBook, mine, true)).toBe(false);
    expect(await mergePayees(t.database, t.grace.id, adasBook, mine, other)).toBe(false);
    expect(await payeeMonths(t.database, t.grace.id, adasBook, mine)).toEqual([]);
    // Merging a payee of Ada's into one of her own is not allowed either.
    const hers = await createTransaction(t.database, t.grace.id, gracesBook, {
      type: 'expense',
      date: '2026-11-06',
      payee: 'Ada Private',
      lines: [
        { account: await seedAccount(t.database, gracesBook, 'USD'), amount: -5, currency: 'USD' },
        { subcategory: await seedSubcategory(t.database, gracesBook), amount: 5, currency: 'USD' },
      ],
    });
    expect(hers.ok).toBe(true);
    const herPayee = (await listPayees(t.database, t.grace.id, gracesBook))[0]?.id as string;
    expect(herPayee).not.toBe(mine);
    expect(await mergePayees(t.database, t.grace.id, gracesBook, mine, herPayee)).toBe(false);
    expect(await mergePayees(t.database, t.grace.id, gracesBook, herPayee, mine)).toBe(false);
    expect((await getPayee(t.database, t.ada.id, adasBook, mine))?.name).toBe('Ada Private');
    expect(
      await createTransaction(t.database, t.grace.id, adasBook, {
        type: 'expense',
        date: '2026-11-06',
        payee: 'Intruder',
        lines: [
          { account: bank, amount: -1, currency: 'USD' },
          { subcategory: food, amount: 1, currency: 'USD' },
        ],
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await names({ query: 'intruder' })).toEqual([]);
  });
});
