import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { setBudget } from '../budget/amounts';
import { createCategory, createSubcategory } from '../budget/categories';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { ensureBook, findBook, type Book } from '../ledger/books';
import { createTransaction } from '../ledger/transactions';
import { setupCurrency } from '../setup/setup';
import { loadInsights } from './load';

const { leg } = testTarget();
const NOW = new Date('2026-11-09T12:00:00Z');

let t: TwoAccounts;
let book: Book;
let bank: string;
let food: string;
let fun: string;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  const id = t.ada.id;
  book = (await findBook(t.database, id)) as Book;
  const okay = <T extends { ok: boolean }>(result: T) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  };
  await setupCurrency(t.database, id, book.id, { currency: 'USD', timeZone: 'UTC' }, NOW.getTime());
  book = (await findBook(t.database, id)) as Book;
  bank = okay(
    await createAccount(t.database, id, book.id, {
      type: 'bank',
      name: 'Bank',
      currency: 'USD',
      opening: { amount: 10_000_000, date: '2026-01-01' },
    }),
  ).id;
  const home = okay(await createCategory(t.database, id, book.id, { name: 'Home' })).id;
  food = okay(await createSubcategory(t.database, id, book.id, home, { name: 'Groceries' })).id;
  fun = okay(await createSubcategory(t.database, id, book.id, home, { name: 'Fun' })).id;
  await setBudget(t.database, id, book.id, {
    kind: 'subcategory',
    targetId: food,
    amount: 10_000,
    when: 'this',
    currentMonth: '2026-01',
  });
}, 120_000);
afterAll(async () => t.close());

const spend = async (date: string, sub: string, amount: number) => {
  const made = await createTransaction(t.database, t.ada.id, book.id, {
    type: 'expense',
    date,
    lines: [
      { account: bank, amount: -amount, currency: 'USD' },
      { subcategory: sub, amount, currency: 'USD' },
    ],
  });
  if (!made.ok) throw new Error(JSON.stringify(made));
};

describe(`insights from a book (${leg})`, () => {
  it('says nothing for a book with no history, and for one month over its budget', async () => {
    expect(await loadInsights(t.database, t.ada.id, book, NOW)).toEqual([]);
    await spend('2026-10-10', food, 15_000);
    expect(await loadInsights(t.database, t.ada.id, book, NOW)).toEqual([]);
  });

  it('says exactly the one for a second month over budget, with a link to it, and goes when the month before is not over', async () => {
    await spend('2026-09-10', food, 12_000);
    const found = await loadInsights(t.database, t.ada.id, book, NOW);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'over_budget_again',
      href: `/budget?month=2026-10&row=${food}`,
    });
    expect(found[0]?.text).toContain('Groceries was over its budget in each of the last 2 months');
    // A report of a month earlier (September, through which August and September are looked at) has only one over.
    expect(await loadInsights(t.database, t.ada.id, book, NOW, { month: '2026-09' })).toEqual([]);
    // November's report looks at the two months before it, which are the same two.
    expect(await loadInsights(t.database, t.ada.id, book, NOW, { month: '2026-11' })).toHaveLength(
      1,
    );
  });

  it('says an unusually large expense once there are five others to compare with, in Overview and in that month’s report', async () => {
    for (const date of ['2026-06-10', '2026-07-10', '2026-08-10', '2026-09-12', '2026-10-12'])
      await spend(date, fun, 1_000);
    await spend('2026-11-05', fun, 3_500);
    const overview = await loadInsights(t.database, t.ada.id, book, NOW);
    expect(overview.map((i) => i.kind)).toEqual(['over_budget_again', 'unusually_large']);
    const large = overview.find((i) => i.kind === 'unusually_large');
    expect(large?.text).toBe(
      '$35.00 on Fun on 2026-11-05 is more than three times the usual $10.00.',
    );
    expect(large?.href).toBe(`/transactions?subcategory=${fun}`);
    expect(
      (await loadInsights(t.database, t.ada.id, book, NOW, { month: '2026-11' })).map(
        (i) => i.kind,
      ),
    ).toContain('unusually_large');
    // October's report has no large expense in it.
    expect(
      (await loadInsights(t.database, t.ada.id, book, NOW, { month: '2026-10' })).map(
        (i) => i.kind,
      ),
    ).not.toContain('unusually_large');
    expect(await loadInsights(t.database, t.ada.id, book, NOW, { limit: 1 })).toHaveLength(1);
  });

  it('is nothing for another person’s book', async () => {
    const hers = (await findBook(t.database, t.grace.id)) as Book;
    expect(await loadInsights(t.database, t.grace.id, hers, NOW)).toEqual([]);
    expect(await loadInsights(t.database, t.grace.id, { ...hers, id: book.id }, NOW)).toEqual([]);
  });
});
