import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { storeRates } from '../fx/rates';
import { type Book, ensureBook, findBook } from '../ledger/books';
import { seedAccount } from '../ledger/testing';
import { createTransaction } from '../ledger/transactions';
import { setBudget } from './amounts';
import { createCategory, createSubcategory } from './categories';
import { loadBudget, spentInMonth } from './screen';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let book: Book;
let groceries: string;
let movies: string;
let hotel: string;
let usd: string;
let eur: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  await dbAll(
    t.database,
    sql`UPDATE ${tableNamed(t.database, 'book')} SET base_currency = 'USD' WHERE id = ${adas} RETURNING id`,
  );
  book = (await findBook(t.database, t.ada.id)) as Book;
  const sub = async (categoryId: string, name: string) => {
    const result = await createSubcategory(t.database, t.ada.id, adas, categoryId, { name });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.id;
  };
  const food = await createCategory(t.database, t.ada.id, adas, { name: 'Food' });
  const trips = await createCategory(t.database, t.ada.id, adas, {
    name: 'Trips',
    currency: 'EUR',
  });
  if (!food.ok || !trips.ok) throw new Error('categories');
  groceries = await sub(food.id, 'Groceries');
  movies = await sub(food.id, 'Movies');
  hotel = await sub(trips.id, 'Hotel');
  usd = await seedAccount(t.database, adas, 'USD', 'bank', 'USD bank');
  eur = await seedAccount(t.database, adas, 'EUR', 'bank', 'EUR bank');
  await storeRates(t.database, '2026-10-30', new Map([['EUR', '0.9']]), 1);
  await storeRates(t.database, '2026-11-15', new Map([['EUR', '0.8']]), 1);
});
afterAll(async () => t.close());

const spend = async (
  account: string,
  currency: string,
  date: string,
  lines: [string, number][],
) => {
  const total = lines.reduce((sum, [, amount]) => sum + amount, 0);
  const result = await createTransaction(t.database, t.ada.id, adas, {
    type: 'expense',
    date,
    lines: [
      { account, amount: -total, currency },
      ...lines.map(([subcategory, amount]) => ({ subcategory, amount, currency })),
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
};
const rowOf = (figures: Awaited<ReturnType<typeof loadBudget>>, id: string) =>
  figures.groups.flatMap((g) => g.rows).find((r) => r.subcategory.id === id);

describe(`the budget of a month (${leg})`, () => {
  it('counts a split in both rows, a refund off, and nothing from another month', async () => {
    await spend(usd, 'USD', '2026-11-05', [
      [groceries, 6_100],
      [movies, 2_320],
    ]); // 84.20 as 61.00 and 23.20
    await spend(usd, 'USD', '2026-11-06', [[groceries, 1_000]]);
    await createTransaction(t.database, t.ada.id, adas, {
      type: 'expense',
      date: '2026-11-07',
      lines: [
        { account: usd, amount: 300, currency: 'USD' },
        { subcategory: groceries, amount: -300, currency: 'USD' },
      ],
    });
    await spend(usd, 'USD', '2026-10-31', [[groceries, 99_999]]);
    await spend(usd, 'USD', '2026-12-01', [[groceries, 88_888]]);
    expect(
      (await spentInMonth(t.database, t.ada.id, adas, '2026-11'))
        .filter((s) => s.subcategoryId === groceries)
        .map((s) => [s.date, s.amount]),
    ).toEqual([
      ['2026-11-05', 6_100],
      ['2026-11-06', 1_000],
      ['2026-11-07', -300],
    ]);
    await setBudget(t.database, t.ada.id, adas, {
      kind: 'subcategory',
      targetId: groceries,
      amount: 70_000,
      when: 'this',
      currentMonth: '2026-11',
    });
    const figures = await loadBudget(
      t.database,
      t.ada.id,
      book,
      '2026-11',
      new Date('2026-12-05T00:00:00Z'),
    );
    expect(rowOf(figures, groceries)).toMatchObject({
      budgeted: 70_000,
      spent: { amount: 6_100 + 1_000 - 300 },
    });
    expect(rowOf(figures, movies)).toMatchObject({ budgeted: null, spent: { amount: 2_320 } });
    const october = await loadBudget(
      t.database,
      t.ada.id,
      book,
      '2026-10',
      new Date('2026-12-05T00:00:00Z'),
    );
    expect(rowOf(october, groceries)).toMatchObject({ budgeted: null, spent: { amount: 99_999 } });
  });

  it('converts a USD expense in a EUR category at its own date, and the screen’s total is the sum of its rows converted', async () => {
    await spend(usd, 'USD', '2026-11-10', [[hotel, 10_000]]); // 100.00 USD at 0.9 = 90.00 EUR
    await spend(usd, 'USD', '2026-11-20', [[hotel, 10_000]]); // at 0.8 = 80.00 EUR
    await spend(eur, 'EUR', '2026-11-21', [[hotel, 5_000]]); // already EUR
    const figures = await loadBudget(
      t.database,
      t.ada.id,
      book,
      '2026-11',
      new Date('2026-12-05T00:00:00Z'),
    );
    expect(rowOf(figures, hotel)?.spent).toMatchObject({
      currency: 'EUR',
      amount: 9_000 + 8_000 + 5_000,
    });
    // The category's EUR 220.00 is 275.00 USD at the month's-end rate (0.8); Food is in dollars.
    const food =
      (rowOf(figures, groceries)?.spent.amount ?? 0) + (rowOf(figures, movies)?.spent.amount ?? 0);
    expect(figures.spent).toMatchObject({
      currency: 'USD',
      amount: food + 27_500,
      notIncluded: [],
    });
  });

  it('is nothing of another person’s: their book has no rows and no spending', async () => {
    await ensureBook(t.database, t.grace.id);
    const hers = (await findBook(t.database, t.grace.id)) as Book;
    const figures = await loadBudget(t.database, t.grace.id, hers, '2026-11');
    expect(figures.groups.flatMap((g) => g.rows)).toEqual([]);
    expect(await spentInMonth(t.database, t.grace.id, adas, '2026-11')).toEqual([]);
    // Her book has no base currency yet, so nothing is converted and there is no total of nothing in any currency.
    expect(figures.byCurrency.spent).toEqual([]);
  });
});
