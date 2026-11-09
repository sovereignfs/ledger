import { describe, expect, it } from 'vitest';
import {
  type CompletedMonth,
  type ExpenseLine,
  allInsights,
  median,
  overBudgetAgain,
  unusuallyLarge,
} from './rules';

const row = (id: string, budgeted: number | null, spent: number) => ({
  subcategoryId: id,
  name: id.toUpperCase(),
  currency: 'USD',
  budgeted,
  spent,
});
const month = (name: string, ...rows: ReturnType<typeof row>[]): CompletedMonth => ({
  month: name,
  rows,
});

describe('over budget again', () => {
  it('says nothing from a single month, however far over it is', () => {
    expect(overBudgetAgain([month('2026-10', row('food', 100, 900))])).toEqual([]);
    expect(overBudgetAgain([])).toEqual([]);
  });

  it('says exactly the one subcategory that was over in both of the last two months', () => {
    const found = overBudgetAgain([
      month('2026-10', row('food', 100, 150), row('fun', 100, 150), row('fuel', 100, 50)),
      month('2026-09', row('food', 100, 120), row('fun', 100, 90), row('fuel', 100, 500)),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: 'over:food:2026-10',
      kind: 'over_budget_again',
      href: '/budget?month=2026-10&row=food',
    });
    expect(found[0]?.text).toContain(
      'FOOD was over its budget in each of the last 2 months, by $0.50 in 2026-10',
    );
  });

  it('is silent when the month before was not over, or only an older one was', () => {
    expect(
      overBudgetAgain([month('2026-10', row('a', 100, 101)), month('2026-09', row('a', 100, 100))]),
    ).toEqual([]);
    expect(
      overBudgetAgain([month('2026-10', row('a', 100, 100)), month('2026-09', row('a', 100, 200))]),
    ).toEqual([]);
  });

  it('is silent for months that are not consecutive, or with no budget in force (which is nothing to be over)', () => {
    expect(
      overBudgetAgain([month('2026-10', row('a', 100, 200)), month('2026-08', row('a', 100, 200))]),
    ).toEqual([]);
    expect(
      overBudgetAgain([
        month('2026-10', row('a', null, 200)),
        month('2026-09', row('a', null, 200)),
      ]),
    ).toEqual([]);
    expect(
      overBudgetAgain([month('2026-10', row('a', 0, 200)), month('2026-09', row('a', 0, 200))]),
    ).toEqual([]);
  });

  it('counts back from the last completed month and asks for as many months as it is told', () => {
    const three = [
      month('2026-10', row('a', 100, 200)),
      month('2026-09', row('a', 100, 200)),
      month('2026-08', row('a', 100, 50)),
    ];
    expect(overBudgetAgain(three, 2)).toHaveLength(1);
    expect(overBudgetAgain(three, 3)).toEqual([]);
    expect(overBudgetAgain(three.slice(0, 2), 3)).toEqual([]);
  });
});

const expense = (
  id: string,
  date: string,
  amount: number,
  sub = 'food',
  currency = 'USD',
): ExpenseLine => ({
  txnId: id,
  date,
  subcategoryId: sub,
  name: sub.toUpperCase(),
  currency,
  amount,
});
const usual = [
  expense('a', '2026-06-10', 1_000),
  expense('b', '2026-07-10', 1_000),
  expense('c', '2026-08-10', 1_000),
  expense('d', '2026-09-10', 1_000),
  expense('e', '2026-10-10', 1_000),
];
const window = { from: '2026-11-01', to: '2026-11-30' };

describe('an unusually large expense', () => {
  it('fires for more than three times the median of at least five others, and says the two amounts', () => {
    const found = unusuallyLarge([...usual, expense('big', '2026-11-05', 3_001)], window);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: 'large:big:food',
      kind: 'unusually_large',
      href: '/transactions?subcategory=food',
    });
    expect(found[0]?.text).toBe(
      '$30.01 on FOOD on 2026-11-05 is more than three times the usual $10.00.',
    );
  });

  it('is silent for exactly three times, and for fewer than five to compare', () => {
    expect(unusuallyLarge([...usual, expense('big', '2026-11-05', 3_000)], window)).toEqual([]);
    expect(
      unusuallyLarge([...usual.slice(0, 4), expense('big', '2026-11-05', 9_000)], window),
    ).toEqual([]);
  });

  it('compares only the six months before, the same subcategory and the same currency, and never with itself or later ones', () => {
    const old = [
      expense('o1', '2026-01-10', 1_000),
      expense('o2', '2026-02-10', 1_000),
      expense('o3', '2026-03-10', 1_000),
      expense('o4', '2026-04-10', 1_000),
      expense('o5', '2026-05-01', 1_000),
    ];
    expect(unusuallyLarge([...old, expense('big', '2026-11-05', 9_000)], window)).toEqual([]);
    const elsewhere = usual.map((each) => ({ ...each, subcategoryId: 'fun' }));
    expect(unusuallyLarge([...elsewhere, expense('big', '2026-11-05', 9_000)], window)).toEqual([]);
    const euros = usual.map((each) => ({ ...each, currency: 'EUR' }));
    expect(unusuallyLarge([...euros, expense('big', '2026-11-05', 9_000)], window)).toEqual([]);
    const later = usual.map((each, at) => ({ ...each, date: `2026-11-1${at}` }));
    expect(
      unusuallyLarge([...later, expense('big', '2026-11-05', 9_000)], window).map((i) => i.id),
    ).toEqual([]);
  });

  it('is by the median, which a few large ones among the others do not move, and only for expenses in the window', () => {
    const mixed = [
      ...usual.slice(0, 4),
      expense('x', '2026-10-20', 90_000),
      expense('y', '2026-10-21', 90_000),
    ];
    expect(unusuallyLarge([...mixed, expense('big', '2026-11-05', 3_001)], window)).toHaveLength(1);
    expect(unusuallyLarge([...usual, expense('big', '2026-12-05', 9_000)], window)).toEqual([]);
    expect(unusuallyLarge([...usual, expense('big', '2026-10-30', 9_000)], window)).toEqual([]);
  });
});

describe('the median', () => {
  it('is the middle, or the two middles’ mean rounded half to even', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2);
    expect(median([2, 4, 6, 8])).toBe(5);
    expect(median([1, 2])).toBe(2);
    expect(median([2, 3])).toBe(2);
    expect(median([3, 4])).toBe(4);
  });
});

describe('every insight', () => {
  it('puts over budget again first, and keeps the first few', () => {
    const months = [month('2026-10', row('a', 100, 200)), month('2026-09', row('a', 100, 200))];
    const expenses = [...usual, expense('big', '2026-11-05', 9_000)];
    const all = allInsights({ months, expenses, window });
    expect(all.map((i) => i.kind)).toEqual(['over_budget_again', 'unusually_large']);
    expect(allInsights({ months, expenses, window }, 1)).toHaveLength(1);
    expect(allInsights({ months: [], expenses: [], window })).toEqual([]);
  });
});
