import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { setBudget } from '../budget/amounts';
import { createCategory, createSubcategory } from '../budget/categories';
import { createIncomeSource } from '../budget/income-sources';
import { testTarget } from '../db/test-support';
import { storeRates } from '../fx/rates';
import { createAccount } from '../ledger/accounts';
import { ensureBook, findBook, type Book } from '../ledger/books';
import { createTransaction } from '../ledger/transactions';
import { setupCurrency } from '../setup/setup';
import { type YearReport, loadYearReport, monthsOfYear } from './year';

const { leg } = testTarget();
const NOW = new Date('2027-01-15T12:00:00Z');

describe('the months of a year (pure)', () => {
  it('is all twelve for a year that is over, those so far for this one, and none for one that has not begun', () => {
    expect(monthsOfYear('2026', '2027-01-15')).toHaveLength(12);
    expect(monthsOfYear('2027', '2027-03-15')).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(monthsOfYear('2028', '2027-03-15')).toEqual([]);
    expect(monthsOfYear('nope', '2027-03-15')).toEqual([]);
  });
});

let t: TwoAccounts;
let book: Book;
let year: YearReport;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  const id = t.ada.id;
  book = (await findBook(t.database, id)) as Book;
  const b = book.id;
  const okay = <T extends { ok: boolean }>(result: T) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  };
  await setupCurrency(t.database, id, b, { currency: 'USD', timeZone: 'UTC' }, NOW.getTime());
  // A euro is 1.25 dollars from March, and a dollar from September.
  await storeRates(t.database, '2026-03-01', new Map([['EUR', '0.8']]), 1);
  await storeRates(t.database, '2026-09-01', new Map([['EUR', '1.0']]), 1);
  const bank = okay(
    await createAccount(t.database, id, b, {
      type: 'bank',
      name: 'Bank',
      currency: 'USD',
      opening: { amount: 1_000_000, date: '2025-12-01' },
    }),
  ).id;
  const euros = okay(
    await createAccount(t.database, id, b, {
      type: 'bank',
      name: 'Euros',
      currency: 'EUR',
      opening: { amount: 1_000_000, date: '2025-12-01' },
    }),
  ).id;
  const pay = okay(await createIncomeSource(t.database, id, b, { name: 'Pay' })).id;
  const home = okay(await createCategory(t.database, id, b, { name: 'Home' })).id;
  const food = okay(await createSubcategory(t.database, id, b, home, { name: 'Groceries' })).id;
  // The budget is 100 until June and 200 from July; the income budget is 900 throughout.
  await setBudget(t.database, id, b, {
    kind: 'subcategory',
    targetId: food,
    amount: 10_000,
    when: 'this',
    currentMonth: '2026-01',
  });
  await setBudget(t.database, id, b, {
    kind: 'subcategory',
    targetId: food,
    amount: 20_000,
    when: 'this',
    currentMonth: '2026-07',
  });
  await setBudget(t.database, id, b, {
    kind: 'income',
    targetId: pay,
    amount: 90_000,
    when: 'this',
    currentMonth: '2026-01',
  });
  const write = async (input: Parameters<typeof createTransaction>[3]) =>
    okay(await createTransaction(t.database, id, b, input));
  await write({
    type: 'income',
    date: '2026-01-02',
    lines: [
      { account: bank, amount: 100_000, currency: 'USD' },
      { incomeSource: pay, amount: -100_000, currency: 'USD' },
    ],
  });
  await write({
    type: 'expense',
    date: '2026-01-05',
    lines: [
      { account: bank, amount: -5_000, currency: 'USD' },
      { subcategory: food, amount: 5_000, currency: 'USD' },
    ],
  });
  // 80 euros in March is 100 dollars; 80 euros in September is 80 dollars.
  await write({
    type: 'expense',
    date: '2026-03-10',
    lines: [
      { account: euros, amount: -8_000, currency: 'EUR' },
      { subcategory: food, amount: 8_000, currency: 'EUR' },
    ],
  });
  await write({
    type: 'expense',
    date: '2026-09-10',
    lines: [
      { account: euros, amount: -8_000, currency: 'EUR' },
      { subcategory: food, amount: 8_000, currency: 'EUR' },
    ],
  });
  book = (await findBook(t.database, id)) as Book;
  year = await loadYearReport(t.database, id, book, '2026', NOW);
}, 120_000);
afterAll(async () => t.close());

describe(`a year, worked by hand (${leg})`, () => {
  it('totals each month at the budget it had then: 6 × 100 and 6 × 200 is 1,800 for groceries, not 12 × 200', () => {
    const home = year.categories.find((c) => c.name === 'Home');
    expect(home?.budgeted).toBe(180_000);
    const groceries = home?.rows[0];
    expect(groceries?.budgeted).toBe(180_000);
    expect(groceries?.months.map((m) => m.budgeted)).toEqual([
      10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 20_000, 20_000, 20_000, 20_000, 20_000,
      20_000,
    ]);
    expect(year.totals.budgetedSpending).toBe(180_000);
  });

  it('converts each month at the rates of its own days: 80 euros is 100 dollars in March and 80 in September', () => {
    const groceries = year.categories[0]?.rows[0];
    expect(groceries?.months.map((m) => m.spent)).toEqual([
      5_000, 0, 10_000, 0, 0, 0, 0, 0, 8_000, 0, 0, 0,
    ]);
    expect(groceries?.spent).toBe(23_000);
    expect(year.totals.spent).toBe(23_000);
  });

  it('adds the income and the savings of the months, and says each month’s figures', () => {
    expect(year.months).toHaveLength(12);
    expect(year.months[0]).toMatchObject({
      month: '2026-01',
      received: 100_000,
      spent: 5_000,
      saved: 95_000,
      budgetedIncome: 90_000,
    });
    expect(year.totals.received).toBe(100_000);
    expect(year.totals.budgetedIncome).toBe(12 * 90_000);
    expect(year.totals.actual).toBe(100_000 - 23_000);
    // Projected is each month's budgeted income less its budgeted spending: 12 × 900 less 1,800.
    expect(year.totals.projected).toBe(12 * 90_000 - 180_000);
    expect(year.notIncluded).toEqual([]);
  });

  it('is only the months so far for this year, and nothing for a year that has not begun', async () => {
    const early = await loadYearReport(
      t.database,
      t.ada.id,
      book,
      '2027',
      new Date('2027-03-15T12:00:00Z'),
    );
    expect(early.months.map((m) => m.month)).toEqual(['2027-01', '2027-02', '2027-03']);
    const none = await loadYearReport(t.database, t.ada.id, book, '2031', NOW);
    expect(none.months).toEqual([]);
    expect(none.totals.received).toBeNull();
  });

  it('is empty for another person', async () => {
    const hers = (await findBook(t.database, t.grace.id)) as Book;
    const theirs = await loadYearReport(
      t.database,
      t.grace.id,
      { ...hers, id: book.id },
      '2026',
      NOW,
    );
    expect(theirs.categories).toEqual([]);
    expect(theirs.totals.received ?? 0).toBe(0);
  });
});
