import { describe, expect, it } from 'vitest';
import { addMonths, isMonth, monthOf } from '../dates';
import { budgetFor } from './budget-for';

describe('the budget in force for a month', () => {
  const rows = [
    { fromMonth: '2026-03', amount: 45_000 },
    { fromMonth: '2026-01', amount: 40_000 },
    { fromMonth: '2026-06', amount: 0 },
  ];

  it('is the latest row not after the month, whatever order the rows came in', () => {
    expect(budgetFor(rows, '2026-01')).toBe(40_000);
    expect(budgetFor(rows, '2026-02')).toBe(40_000);
    expect(budgetFor(rows, '2026-03')).toBe(45_000);
    expect(budgetFor(rows, '2026-05')).toBe(45_000);
    expect(budgetFor(rows, '2027-12')).toBe(0);
  });

  it('is a raise from March that leaves February as it was', () => {
    const before = [{ fromMonth: '2026-01', amount: 40_000 }];
    const after = [...before, { fromMonth: '2026-03', amount: 45_000 }];
    expect(budgetFor(after, '2026-02')).toBe(budgetFor(before, '2026-02'));
    expect(budgetFor(after, '2026-03')).toBe(45_000);
  });

  it('is no budget before the first row, which is not a budget of nothing, and for no rows', () => {
    expect(budgetFor(rows, '2025-12')).toBeUndefined();
    expect(budgetFor([], '2026-03')).toBeUndefined();
    expect(budgetFor([{ fromMonth: '2026-03', amount: 0 }], '2026-03')).toBe(0);
  });

  it('is a budget that ended: a zero from its month on', () => {
    expect(budgetFor(rows, '2026-05')).toBe(45_000);
    expect(budgetFor(rows, '2026-06')).toBe(0);
  });
});

describe('months', () => {
  it('are told from days and from what is not a month', () => {
    expect(isMonth('2026-11')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-11', '2026-11-09', '', 'soon'])
      expect(isMonth(bad), bad).toBe(false);
    expect(monthOf('2026-11-09')).toBe('2026-11');
  });

  it('are added across the year, and taken away', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-03', 0)).toBe('2026-03');
    expect(addMonths('2026-03', 24)).toBe('2028-03');
    expect(addMonths('2026-03', -15)).toBe('2024-12');
  });
});
