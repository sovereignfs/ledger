import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { ensureBook } from '../ledger/books';
import { listCurrencies } from '../ledger/currencies';
import { seedAccount } from '../ledger/testing';
import { createTransaction, updateTransaction } from '../ledger/transactions';
import {
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  listCategories,
  renameCategory,
  renameSubcategory,
  reorderCategories,
  reorderSubcategories,
  setCategoryArchived,
} from './categories';

const { leg } = testTarget();

let t: TwoAccounts;
let adasBook: string;
let gracesBook: string;
beforeAll(async () => {
  t = await twoAccounts();
  adasBook = (await ensureBook(t.database, t.ada.id)).id;
  gracesBook = (await ensureBook(t.database, t.grace.id)).id;
  await dbAll(
    t.database,
    sql`UPDATE ${tableNamed(t.database, 'book')} SET base_currency = 'USD' WHERE id = ${adasBook} RETURNING id`,
  );
});
afterAll(async () => t.close());

const cat = async (name: string, currency?: string) => {
  const result = await createCategory(t.database, t.ada.id, adasBook, { name, currency });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
};
const sub = async (categoryId: string, name: string) => {
  const result = await createSubcategory(t.database, t.ada.id, adasBook, categoryId, { name });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
};
const list = () => listCategories(t.database, t.ada.id, adasBook);
const spend = async (subcategory: string) => {
  const bank = await seedAccount(t.database, adasBook, 'USD');
  return createTransaction(t.database, t.ada.id, adasBook, {
    type: 'expense',
    date: '2026-11-06',
    lines: [
      { account: bank, amount: -100, currency: 'USD' },
      { subcategory, amount: 100, currency: 'USD' },
    ],
  });
};

describe(`categories (${leg})`, () => {
  it('are made with the base currency by default, in order, and their currency joins the book’s', async () => {
    const home = await cat('  Home  ');
    const trips = await cat('Trips', 'EUR');
    const rows = await list();
    expect(
      rows.filter((c) => [home, trips].includes(c.id)).map((c) => [c.name, c.currency]),
    ).toEqual([
      ['Home', 'USD'],
      ['Trips', 'EUR'],
    ]);
    expect(await listCurrencies(t.database, t.ada.id, adasBook)).toContain('EUR');
  });

  it('refuse a name that is empty, long or taken (in any case), and a currency that is not one', async () => {
    await cat('Food');
    const refuse = async (name: string, currency?: string) =>
      createCategory(t.database, t.ada.id, adasBook, { name, currency });
    expect(await refuse('')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await refuse('x'.repeat(61))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await refuse('FOOD')).toEqual({
      ok: false,
      reason: 'invalid',
      problems: ['There is already a category with that name.'],
    });
    expect(await refuse('Other', 'BTC')).toMatchObject({ ok: false, reason: 'invalid' });
    // The same name in another person’s book is theirs to have.
    expect(
      (await createCategory(t.database, t.grace.id, gracesBook, { name: 'Food', currency: 'USD' }))
        .ok,
    ).toBe(true);
  });

  it('need a currency when the book has no base currency yet', async () => {
    expect(
      await createCategory(t.database, t.grace.id, gracesBook, { name: 'No base' }),
    ).toMatchObject({
      ok: false,
      problems: [expect.stringContaining('no base currency')],
    });
  });

  it('hold subcategories in order, with names unique inside the category and free in another', async () => {
    const a = await cat('Eating out');
    const b = await cat('Groceries');
    const s1 = await sub(a, 'Lunch');
    const s2 = await sub(a, 'Dinner');
    expect((await list()).find((c) => c.id === a)?.subcategories.map((s) => s.name)).toEqual([
      'Lunch',
      'Dinner',
    ]);
    expect(await createSubcategory(t.database, t.ada.id, adasBook, a, { name: 'lunch' })).toEqual({
      ok: false,
      reason: 'invalid',
      problems: ['There is already a subcategory with that name in this category.'],
    });
    expect((await createSubcategory(t.database, t.ada.id, adasBook, b, { name: 'Lunch' })).ok).toBe(
      true,
    );
    expect(s1).not.toBe(s2);
  });

  it('are renamed, with the same rules about names, and reordered, subcategories and all', async () => {
    const a = await cat('Rename me');
    const b = await cat('Second');
    expect(await renameCategory(t.database, t.ada.id, adasBook, a, 'Renamed')).toEqual({
      ok: true,
      id: a,
    });
    expect(await renameCategory(t.database, t.ada.id, adasBook, a, 'second')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(await renameCategory(t.database, t.ada.id, adasBook, a, 'RENAMED')).toEqual({
      ok: true,
      id: a,
    });
    const s1 = await sub(a, 'One');
    const s2 = await sub(a, 'Two');
    expect(await renameSubcategory(t.database, t.ada.id, adasBook, s1, 'Uno')).toEqual({
      ok: true,
      id: s1,
    });
    expect(await renameSubcategory(t.database, t.ada.id, adasBook, s1, 'two')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(await reorderSubcategories(t.database, t.ada.id, adasBook, a, [s2, s1])).toBe(true);
    expect((await list()).find((c) => c.id === a)?.subcategories.map((s) => s.name)).toEqual([
      'Two',
      'Uno',
    ]);
    expect(await reorderCategories(t.database, t.ada.id, adasBook, [b, a])).toBe(true);
    const order = (await list()).map((c) => c.id);
    expect(order.indexOf(b)).toBeLessThan(order.indexOf(a));
    // A repeat, a stranger and an id that is not there change nothing.
    expect(await reorderCategories(t.database, t.ada.id, adasBook, [a, a])).toBe(false);
    expect(await reorderCategories(t.database, t.ada.id, adasBook, [a, crypto.randomUUID()])).toBe(
      false,
    );
    expect((await list()).map((c) => c.id)).toEqual(order);
  });

  it('can be deleted while nothing has been spent, and not after: archiving is what is left', async () => {
    const free = await cat('Disposable');
    const s = await sub(free, 'Nothing');
    expect(await deleteSubcategory(t.database, t.ada.id, adasBook, s)).toBe('deleted');
    expect(await deleteCategory(t.database, t.ada.id, adasBook, free)).toBe('deleted');
    expect((await list()).some((c) => c.id === free)).toBe(false);

    const used = await cat('Used');
    const spent = await sub(used, 'Spent on');
    const unused = await sub(used, 'Never spent');
    expect((await spend(spent)).ok).toBe(true);
    const row = (await list()).find((c) => c.id === used);
    expect(row?.deletable).toBe(false);
    expect(row?.subcategories.map((x) => [x.name, x.used])).toEqual([
      ['Spent on', true],
      ['Never spent', false],
    ]);
    expect(await deleteSubcategory(t.database, t.ada.id, adasBook, spent)).toBe('in_use');
    expect(await deleteCategory(t.database, t.ada.id, adasBook, used)).toBe('in_use');
    expect(await deleteSubcategory(t.database, t.ada.id, adasBook, unused)).toBe('deleted');
    expect(await deleteCategory(t.database, t.ada.id, adasBook, used)).toBe('in_use');
    expect((await list()).find((c) => c.id === used)?.subcategories.map((x) => x.name)).toEqual([
      'Spent on',
    ]);
    expect(await deleteSubcategory(t.database, t.ada.id, adasBook, unused)).toBe('not_found');
  });

  it('cannot be deleted while a loan takes its interest there', async () => {
    const loans = await cat('Loans');
    const interest = await sub(loans, 'Interest');
    const made = await createAccount(t.database, t.ada.id, adasBook, {
      type: 'loan',
      name: 'Car',
      currency: 'USD',
      loan: {
        lender: 'x',
        principal: 100,
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        instalment: 10,
        yearlyRate: null,
        interestSubcategoryId: interest,
      },
    });
    expect(made.ok).toBe(true);
    expect(await deleteSubcategory(t.database, t.ada.id, adasBook, interest)).toBe('in_use');
    expect(await deleteCategory(t.database, t.ada.id, adasBook, loans)).toBe('in_use');
  });
});

describe(`archived categories (${leg})`, () => {
  it('leave the pickers, keep their rows, and an expense cannot be put on one; an entry already on it can still be edited', async () => {
    const group = await cat('Archive me');
    const s = await sub(group, 'Old habit');
    const bank = await seedAccount(t.database, adasBook, 'USD');
    const lines = (amount: number) => [
      { account: bank, amount: -amount, currency: 'USD' },
      { subcategory: s, amount, currency: 'USD' },
    ];
    const made = await createTransaction(t.database, t.ada.id, adasBook, {
      type: 'expense',
      date: '2026-11-06',
      lines: lines(500),
    });
    if (!made.ok) throw new Error('not written');
    expect(await setCategoryArchived(t.database, t.ada.id, adasBook, 'subcategory', s, true)).toBe(
      true,
    );
    expect((await list()).find((c) => c.id === group)?.subcategories[0]?.archivedAt).not.toBeNull();
    // New entries are refused, in a sentence.
    expect(
      await createTransaction(t.database, t.ada.id, adasBook, {
        type: 'expense',
        date: '2026-11-07',
        lines: lines(100),
      }),
    ).toMatchObject({
      ok: false,
      reason: 'invalid',
      problems: ['A subcategory is archived: choose one that is not.'],
    });
    // The old one can still be corrected.
    expect(
      await updateTransaction(t.database, t.ada.id, adasBook, made.id, {
        type: 'expense',
        date: '2026-11-06',
        note: 'fixed',
        lines: lines(600),
      }),
    ).toEqual({ ok: true, id: made.id });
    // Archiving the category does the same to its subcategories, and bringing it back undoes it.
    expect(await setCategoryArchived(t.database, t.ada.id, adasBook, 'subcategory', s, false)).toBe(
      true,
    );
    expect(await setCategoryArchived(t.database, t.ada.id, adasBook, 'category', group, true)).toBe(
      true,
    );
    expect(
      (
        await createTransaction(t.database, t.ada.id, adasBook, {
          type: 'expense',
          date: '2026-11-07',
          lines: lines(100),
        })
      ).ok,
    ).toBe(false);
    expect(await setCategoryArchived(t.database, t.ada.id, adasBook, 'category', group, true)).toBe(
      true,
    );
    expect(
      await setCategoryArchived(t.database, t.ada.id, adasBook, 'category', group, false),
    ).toBe(true);
    expect(
      (
        await createTransaction(t.database, t.ada.id, adasBook, {
          type: 'expense',
          date: '2026-11-07',
          lines: lines(100),
        })
      ).ok,
    ).toBe(true);
  });
});

describe(`another person’s categories (${leg})`, () => {
  it('are not there: nothing is listed, made in, renamed, reordered, archived or deleted', async () => {
    const mine = await cat('Ada private');
    const mineSub = await sub(mine, 'Ada sub');
    const before = JSON.stringify(await list());
    expect(await listCategories(t.database, t.grace.id, adasBook)).toEqual([]);
    expect(
      await createCategory(t.database, t.grace.id, adasBook, { name: 'Intruder', currency: 'USD' }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await createSubcategory(t.database, t.grace.id, adasBook, mine, { name: 'Intruder' }),
    ).toEqual({ ok: false, reason: 'not_found' });
    // Her own book, Ada’s category id.
    expect(
      await createSubcategory(t.database, t.grace.id, gracesBook, mine, { name: 'Intruder' }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await renameCategory(t.database, t.grace.id, adasBook, mine, 'Hers')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await renameCategory(t.database, t.grace.id, gracesBook, mine, 'Hers')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await renameSubcategory(t.database, t.grace.id, adasBook, mineSub, 'Hers')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await reorderCategories(t.database, t.grace.id, adasBook, [mine])).toBe(false);
    expect(await reorderSubcategories(t.database, t.grace.id, adasBook, mine, [mineSub])).toBe(
      false,
    );
    expect(
      await setCategoryArchived(t.database, t.grace.id, adasBook, 'category', mine, true),
    ).toBe(false);
    expect(
      await setCategoryArchived(t.database, t.grace.id, adasBook, 'subcategory', mineSub, true),
    ).toBe(false);
    expect(await deleteSubcategory(t.database, t.grace.id, adasBook, mineSub)).toBe('not_found');
    expect(await deleteCategory(t.database, t.grace.id, adasBook, mine)).toBe('not_found');
    expect(JSON.stringify(await list())).toBe(before);
  });
});
