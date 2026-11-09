import { describe, expect, it } from 'vitest';
import { RateTable } from '../money/convert';
import type { IncomeSourceRow } from './income-sources';
import { incomeFigures, lastDayOf } from './income';

const source = (
  id: string,
  name: string,
  kind: 'primary' | 'secondary',
  currency = 'USD',
  archivedAt: number | null = null,
): IncomeSourceRow => ({
  id,
  name,
  kind,
  currency,
  archivedAt,
  entries: 0,
});
const rates = new RateTable('2026-11-01', '2026-11-30', [
  { currency: 'EUR', asOf: '2026-10-30', rate: '0.9' },
  { currency: 'EUR', asOf: '2026-11-15', rate: '0.8' },
]);
const sources = [
  source('pay', 'Salary', 'primary'),
  source('side', 'Side work', 'secondary', 'EUR'),
];

describe('income planned and received', () => {
  it('keeps the budgeted and the received apart, each converted to the base currency', () => {
    const figures = incomeFigures({
      month: '2026-11',
      sources,
      budgets: new Map([
        ['income:pay', 500_000],
        ['income:side', 90_000],
      ]),
      received: [
        { sourceId: 'pay', currency: 'USD', date: '2026-11-01', amount: 500_000 },
        { sourceId: 'side', currency: 'EUR', date: '2026-11-10', amount: 45_000 }, // 450.00 EUR at 0.9 is 500.00 USD
        { sourceId: 'side', currency: 'EUR', date: '2026-11-20', amount: 40_000 }, // 400.00 EUR at 0.8 is 500.00 USD
      ],
      base: 'USD',
      rates,
      budgetDate: '2026-11-30', // 900.00 EUR at 0.8 is 1,125.00 USD
    });
    expect(figures.received).toEqual({
      currency: 'USD',
      amount: 500_000 + 50_000 + 50_000,
      included: 3,
      notIncluded: [],
    });
    expect(figures.budgeted).toEqual({
      currency: 'USD',
      amount: 500_000 + 112_500,
      included: 2,
      notIncluded: [],
    });
    expect(figures.rows.map((row) => [row.source.name, row.budgeted, row.received])).toEqual([
      ['Salary', 500_000, [{ currency: 'USD', amount: 500_000 }]],
      ['Side work', 90_000, [{ currency: 'EUR', amount: 85_000 }]],
    ]);
  });

  it('reports what it left out for want of a rate, in each figure, and never counts it as nothing', () => {
    const figures = incomeFigures({
      month: '2026-11',
      sources: [source('pay', 'Salary', 'primary'), source('chf', 'Swiss', 'secondary', 'CHF')],
      budgets: new Map([['income:chf', 100_000]]),
      received: [
        { sourceId: 'pay', currency: 'USD', date: '2026-11-01', amount: 1_000 },
        { sourceId: 'chf', currency: 'CHF', date: '2026-11-05', amount: 7_000 },
        { sourceId: 'chf', currency: 'CHF', date: '2026-11-06', amount: 3_000 },
      ],
      base: 'USD',
      rates,
      budgetDate: '2026-11-30',
    });
    expect(figures.received).toMatchObject({
      amount: 1_000,
      included: 1,
      notIncluded: [{ currency: 'CHF', count: 2, amount: 10_000 }],
    });
    expect(figures.budgeted).toMatchObject({
      amount: 0,
      included: 0,
      notIncluded: [{ currency: 'CHF', count: 1, amount: 100_000 }],
    });
  });

  it('is one total for each currency while the book has no base currency, and converts nothing', () => {
    const figures = incomeFigures({
      month: '2026-11',
      sources,
      budgets: new Map([
        ['income:pay', 500_000],
        ['income:side', 90_000],
      ]),
      received: [
        { sourceId: 'pay', currency: 'USD', date: '2026-11-01', amount: 500_000 },
        { sourceId: 'side', currency: 'EUR', date: '2026-11-10', amount: 45_000 },
      ],
      base: null,
      rates,
      budgetDate: '2026-11-30',
    });
    expect(figures.budgeted).toBeNull();
    expect(figures.received).toBeNull();
    expect(figures.byCurrency.received).toEqual([
      { currency: 'EUR', amount: 45_000 },
      { currency: 'USD', amount: 500_000 },
    ]);
    expect(figures.byCurrency.budgeted).toEqual([
      { currency: 'EUR', amount: 90_000 },
      { currency: 'USD', amount: 500_000 },
    ]);
  });

  it('shows a source with no budget in force as having none, which is not a budget of nothing, and leaves out an archived source with nothing to show', () => {
    const figures = incomeFigures({
      month: '2026-11',
      sources: [
        source('pay', 'Salary', 'primary'),
        source('old', 'Old job', 'secondary', 'USD', 5),
      ],
      budgets: new Map(),
      received: [],
      base: 'USD',
      rates,
      budgetDate: '2026-11-30',
    });
    expect(figures.rows.map((row) => [row.source.name, row.budgeted])).toEqual([['Salary', null]]);
    expect(figures.budgeted).toMatchObject({ amount: 0, included: 0 });
    const withIncome = incomeFigures({
      month: '2026-11',
      sources: [source('old', 'Old job', 'secondary', 'USD', 5)],
      budgets: new Map(),
      received: [{ sourceId: 'old', currency: 'USD', date: '2026-11-02', amount: 100 }],
      base: 'USD',
      rates,
      budgetDate: '2026-11-30',
    });
    expect(withIncome.rows.map((row) => row.source.name)).toEqual(['Old job']);
  });
});

describe('the last day of a month', () => {
  it('is told in every month, a leap February and a year end included', () => {
    expect(lastDayOf('2026-11')).toBe('2026-11-30');
    expect(lastDayOf('2026-12')).toBe('2026-12-31');
    expect(lastDayOf('2026-02')).toBe('2026-02-28');
    expect(lastDayOf('2028-02')).toBe('2028-02-29');
    expect(lastDayOf('2026-01')).toBe('2026-01-31');
  });
});
