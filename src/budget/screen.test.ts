import { describe, expect, it } from 'vitest';
import { RateTable } from '../money/convert';
import { buildBudget, type Spent } from './screen';

const sub = (
  id: string,
  name: string,
  budgetSource: 'manual' | 'bills' = 'manual',
  archivedAt: number | null = null,
) => ({
  id,
  name,
  budgetSource,
  position: 0,
  archivedAt,
  used: false,
});
const category = (
  id: string,
  name: string,
  currency: string,
  subcategories: ReturnType<typeof sub>[],
  archivedAt: number | null = null,
) => ({
  id,
  name,
  currency,
  archivedAt,
  subcategories,
});
const rates = new RateTable('2026-11-01', '2026-11-30', [
  { currency: 'EUR', asOf: '2026-10-30', rate: '0.9' },
  { currency: 'EUR', asOf: '2026-11-15', rate: '0.8' },
]);
const input = (over: Partial<Parameters<typeof buildBudget>[0]> = {}) => ({
  month: '2026-11',
  categories: [
    category('food', 'Food', 'USD', [sub('groceries', 'Groceries'), sub('movies', 'Movies')]),
  ],
  budgets: new Map<string, number>(),
  spent: [] as Spent[],
  base: 'USD' as string | null,
  rates,
  budgetDate: '2026-11-30',
  ...over,
});
const row = (figures: ReturnType<typeof buildBudget>, id: string) =>
  figures.groups.flatMap((group) => group.rows).find((each) => each.subcategory.id === id);

describe('a month of the budget', () => {
  it('counts a split in both rows: 84.20 as 61.00 and 23.20 lands in each subcategory', () => {
    const figures = buildBudget(
      input({
        budgets: new Map([
          ['subcategory:groceries', 70_000],
          ['subcategory:movies', 20_000],
        ]),
        spent: [
          { subcategoryId: 'groceries', currency: 'USD', date: '2026-11-05', amount: 6_100 },
          { subcategoryId: 'movies', currency: 'USD', date: '2026-11-05', amount: 2_320 },
        ],
      }),
    );
    expect(row(figures, 'groceries')).toMatchObject({
      budgeted: 70_000,
      spent: { amount: 6_100 },
      over: 0,
    });
    expect(row(figures, 'movies')).toMatchObject({
      budgeted: 20_000,
      spent: { amount: 2_320 },
      over: 0,
    });
    expect(figures.spent).toMatchObject({ currency: 'USD', amount: 8_420 });
    expect(figures.budgeted).toMatchObject({ amount: 90_000 });
  });

  it('converts a USD expense in a EUR category at its own date, not today’s', () => {
    const figures = buildBudget(
      input({
        categories: [category('trip', 'Trips', 'EUR', [sub('hotel', 'Hotel')])],
        spent: [
          { subcategoryId: 'hotel', currency: 'USD', date: '2026-11-10', amount: 10_000 }, // 100.00 USD at EUR 0.9 per USD is 90.00 EUR
          { subcategoryId: 'hotel', currency: 'USD', date: '2026-11-20', amount: 10_000 }, // at 0.8 it is 80.00 EUR
        ],
      }),
    );
    expect(row(figures, 'hotel')?.spent).toMatchObject({
      currency: 'EUR',
      amount: 9_000 + 8_000,
      included: 2,
    });
  });

  it('puts what is over its budget in words, and a refund takes off what was spent', () => {
    const figures = buildBudget(
      input({
        budgets: new Map([['subcategory:groceries', 5_000]]),
        spent: [
          { subcategoryId: 'groceries', currency: 'USD', date: '2026-11-02', amount: 7_000 },
          { subcategoryId: 'groceries', currency: 'USD', date: '2026-11-03', amount: -500 },
        ],
      }),
    );
    expect(row(figures, 'groceries')).toMatchObject({ spent: { amount: 6_500 }, over: 1_500 });
    expect(row(figures, 'movies')).toMatchObject({ budgeted: null, over: 0, spent: { amount: 0 } });
  });

  it('groups bills apart from spending, with saving left for the jars', () => {
    const figures = buildBudget(
      input({
        categories: [
          category('home', 'Home', 'USD', [sub('rent', 'Rent', 'bills'), sub('fixing', 'Fixing')]),
        ],
      }),
    );
    expect(
      figures.groups.map((group) => [group.id, group.rows.map((r) => r.subcategory.name)]),
    ).toEqual([
      ['bills', ['Rent']],
      ['spending', ['Fixing']],
      ['saving', []],
    ]);
  });

  it('rolls up to the base currency: each category in its own currency, then converted, with a missing rate said and never counted as nothing', () => {
    const figures = buildBudget(
      input({
        categories: [
          category('food', 'Food', 'USD', [sub('groceries', 'Groceries')]),
          category('trip', 'Trips', 'EUR', [sub('hotel', 'Hotel')]),
          category('swiss', 'Swiss', 'CHF', [sub('ski', 'Skiing')]),
        ],
        budgets: new Map([
          ['subcategory:groceries', 40_000],
          ['subcategory:hotel', 80_000],
          ['subcategory:ski', 5_000],
        ]),
        spent: [
          { subcategoryId: 'groceries', currency: 'USD', date: '2026-11-02', amount: 10_000 },
          { subcategoryId: 'hotel', currency: 'EUR', date: '2026-11-03', amount: 40_000 },
          { subcategoryId: 'ski', currency: 'CHF', date: '2026-11-04', amount: 9_000 },
        ],
      }),
    );
    // 400.00 EUR at 0.8 is 500.00 USD; the CHF category has no rate to USD.
    expect(figures.spent).toMatchObject({
      currency: 'USD',
      amount: 10_000 + 50_000,
      notIncluded: [{ currency: 'CHF', count: 1, amount: 9_000 }],
    });
    expect(figures.budgeted).toMatchObject({
      amount: 40_000 + 100_000,
      notIncluded: [{ currency: 'CHF', count: 1, amount: 5_000 }],
    });
  });

  it('says what could not be converted into the category’s currency, in the row and in the total', () => {
    const figures = buildBudget(
      input({
        spent: [
          { subcategoryId: 'groceries', currency: 'USD', date: '2026-11-02', amount: 1_000 },
          { subcategoryId: 'groceries', currency: 'CHF', date: '2026-11-02', amount: 2_000 },
        ],
      }),
    );
    expect(row(figures, 'groceries')?.spent).toMatchObject({
      amount: 1_000,
      notIncluded: [{ currency: 'CHF', count: 1, amount: 2_000 }],
    });
    expect(figures.spent?.notIncluded).toEqual([{ currency: 'CHF', count: 1, amount: 2_000 }]);
  });

  it('is one total for each currency while there is no base currency, and converts nothing', () => {
    const figures = buildBudget(
      input({
        base: null,
        categories: [
          category('food', 'Food', 'USD', [sub('groceries', 'Groceries')]),
          category('trip', 'Trips', 'EUR', [sub('hotel', 'Hotel')]),
        ],
        budgets: new Map([
          ['subcategory:groceries', 40_000],
          ['subcategory:hotel', 80_000],
        ]),
        spent: [
          { subcategoryId: 'groceries', currency: 'USD', date: '2026-11-02', amount: 10_000 },
          { subcategoryId: 'hotel', currency: 'EUR', date: '2026-11-03', amount: 40_000 },
        ],
      }),
    );
    expect(figures.spent).toBeNull();
    expect(figures.budgeted).toBeNull();
    expect(figures.byCurrency.spent).toEqual([
      { currency: 'EUR', amount: 40_000 },
      { currency: 'USD', amount: 10_000 },
    ]);
    expect(figures.byCurrency.budgeted).toEqual([
      { currency: 'EUR', amount: 80_000 },
      { currency: 'USD', amount: 40_000 },
    ]);
  });

  it('shows an archived subcategory only while it has something in the month, and leaves a past month as it was', () => {
    const cats = [category('old', 'Old', 'USD', [sub('gone', 'Gone', 'manual', 5)], 5)];
    expect(buildBudget(input({ categories: cats })).groups.flatMap((g) => g.rows)).toEqual([]);
    const withSpend = buildBudget(
      input({
        categories: cats,
        spent: [{ subcategoryId: 'gone', currency: 'USD', date: '2026-11-02', amount: 100 }],
      }),
    );
    expect(row(withSpend, 'gone')).toMatchObject({
      spent: { amount: 100 },
      subcategory: { archived: true },
    });
  });

  it('is nothing for nothing, and totals of nothing are not missing', () => {
    const figures = buildBudget(input());
    expect(figures.spent).toMatchObject({ amount: 0, notIncluded: [] });
    expect(figures.budgeted).toMatchObject({ amount: 0 });
  });
});
