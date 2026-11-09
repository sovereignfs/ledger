import { describe, expect, it } from 'vitest';
import type { IncomeFigures } from '../budget/income';
import type { BudgetFigures, BudgetLine } from '../budget/screen';
import type { ConvertedTotal } from '../money/convert';
import { checklist, closestRows, thisMonth } from './overview';

const total = (
  amount: number,
  currency = 'USD',
  notIncluded: ConvertedTotal['notIncluded'] = [],
): ConvertedTotal => ({ currency, amount, included: 1, notIncluded });
const income = (over: Partial<IncomeFigures> = {}): IncomeFigures => ({
  month: '2026-11',
  rows: [],
  base: 'USD',
  budgeted: total(500_000),
  received: total(520_000),
  byCurrency: { budgeted: [], received: [] },
  ...over,
});
const line = (name: string, budgeted: number | null, spent: number): BudgetLine => ({
  subcategory: { id: name, name, budgetSource: 'manual', archived: false },
  category: { id: 'c', name: 'Cat', currency: 'USD' },
  budgeted,
  spent: total(spent),
  over: budgeted !== null && spent > budgeted ? spent - budgeted : 0,
});
const budget = (rows: BudgetLine[], over: Partial<BudgetFigures> = {}): BudgetFigures => ({
  month: '2026-11',
  groups: [{ id: 'spending', title: 'Spending', rows }],
  base: 'USD',
  budgeted: total(300_000),
  spent: total(180_000),
  byCurrency: { budgeted: [], spent: [] },
  ...over,
});

describe('this month', () => {
  it('is income and spending as the other screens have them, and what is saved is the difference of each', () => {
    const month = thisMonth(income(), budget([]));
    expect(month).toMatchObject({
      month: '2026-11',
      base: 'USD',
      projectedSaved: 200_000,
      actualSaved: 340_000,
      notIncluded: [],
    });
    expect(month.received?.amount).toBe(520_000);
    expect(month.spent?.amount).toBe(180_000);
  });

  it('can be below nothing: spending more than was received is a negative saving, and nothing hides it', () => {
    const month = thisMonth(
      income({ received: total(100_000) }),
      budget([], { spent: total(250_000) }),
    );
    expect(month.actualSaved).toBe(-150_000);
  });

  it('says what a figure left out for want of a rate, by which figure', () => {
    const month = thisMonth(
      income({ received: total(1_000, 'USD', [{ currency: 'CHF', count: 2, amount: 10_000 }]) }),
      budget([], { spent: total(500, 'USD', [{ currency: 'CHF', count: 1, amount: 700 }]) }),
    );
    expect(month.notIncluded).toEqual([
      'Income: 2 amounts in CHF not included',
      'Spent: 1 amount in CHF not included',
    ]);
  });

  it('has no saving to speak of while the book has no base currency, and converts nothing', () => {
    const month = thisMonth(
      income({ base: null, budgeted: null, received: null }),
      budget([], { base: null, budgeted: null, spent: null }),
    );
    expect(month).toMatchObject({
      base: null,
      received: null,
      spent: null,
      projectedSaved: null,
      actualSaved: null,
    });
  });
});

describe('the rows closest to their budget', () => {
  it('are the most used first, over ones before the rest, with ties by name, at most as many as asked', () => {
    const rows = [
      line('Fun', 10_000, 20_000),
      line('Groceries', 50_000, 45_000),
      line('Transport', 10_000, 1_000),
      line('Health', 20_000, 20_000),
      line('Bills', 40_000, 40_000),
    ];
    expect(closestRows(budget(rows)).map((r) => [r.line.subcategory.name, r.used])).toEqual([
      ['Fun', 2],
      ['Bills', 1],
      ['Health', 1],
      ['Groceries', 0.9],
      ['Transport', 0.1],
    ]);
    expect(closestRows(budget(rows), 2).map((r) => r.line.subcategory.name)).toEqual([
      'Fun',
      'Bills',
    ]);
  });

  it('leave out a row with no budget, a budget of nothing, or nothing spent, which have nothing to be close to', () => {
    const rows = [
      line('NoBudget', null, 5_000),
      line('Zero', 0, 5_000),
      line('Idle', 10_000, 0),
      line('Refunded', 10_000, -500),
      line('Counted', 10_000, 1),
    ];
    expect(closestRows(budget(rows)).map((r) => r.line.subcategory.name)).toEqual(['Counted']);
    expect(closestRows(budget([]))).toEqual([]);
  });
});

describe('the setup checklist', () => {
  const only = (items: ReturnType<typeof checklist>, id: string) => items.find((i) => i.id === id);

  it('is all to do for a new book, with a place to do each that exists and a word for the ones that do not', () => {
    const items = checklist({
      accounts: [{ type: 'bank' }],
      sources: [{ kind: 'primary', archivedAt: null }],
    });
    expect(items.map((i) => [i.id, i.done])).toEqual([
      ['accounts', false],
      ['debts', false],
      ['income', false],
      ['bills', false],
      ['jars', false],
      ['people', false],
    ]);
    expect(only(items, 'accounts')?.href).toBe('/accounts');
    expect(only(items, 'income')?.href).toBe('/budget/income');
    expect(only(items, 'bills')).toMatchObject({ href: null, note: 'Coming soon' });
    expect(only(items, 'jars')).toMatchObject({ href: null, note: 'Coming soon' });
  });

  it('ticks off what the book has: a second account, a card or a loan, a secondary source, a person', () => {
    const items = checklist({
      accounts: [{ type: 'bank' }, { type: 'credit_card' }, { type: 'person' }],
      sources: [
        { kind: 'primary', archivedAt: null },
        { kind: 'secondary', archivedAt: null },
      ],
    });
    expect(items.filter((i) => i.done).map((i) => i.id)).toEqual([
      'accounts',
      'debts',
      'income',
      'people',
    ]);
    expect(
      checklist({ accounts: [{ type: 'loan' }], sources: [] }).find((i) => i.id === 'debts')?.done,
    ).toBe(true);
  });

  it('does not count an archived secondary source, or one account as another', () => {
    const items = checklist({
      accounts: [{ type: 'bank' }],
      sources: [{ kind: 'secondary', archivedAt: 5 }],
    });
    expect(items.find((i) => i.id === 'income')?.done).toBe(false);
    expect(items.find((i) => i.id === 'accounts')?.done).toBe(false);
  });
});
