import { describe, expect, it } from 'vitest';
import { amountOf, withAmount } from './present';
import type { Template } from './recurring';

const expense: Template = {
  type: 'expense',
  lines: [
    { account: 'a', amount: -9_000, currency: 'USD' },
    { subcategory: 's', amount: 9_000, currency: 'USD' },
  ],
  payee: 'Power',
  note: null,
};

describe('what a recurring entry comes to', () => {
  it('is what reaches the subcategories, leaves the sources, or reaches the account a transfer goes to', () => {
    expect(amountOf(expense)).toEqual({ amount: 9_000, currency: 'USD' });
    expect(
      amountOf({
        ...expense,
        type: 'income',
        lines: [
          { account: 'a', amount: 5_000, currency: 'EUR' },
          { incomeSource: 'i', amount: -5_000, currency: 'EUR' },
        ],
      }),
    ).toEqual({ amount: 5_000, currency: 'EUR' });
    expect(
      amountOf({
        ...expense,
        type: 'transfer',
        lines: [
          { account: 'a', amount: -700, currency: 'USD' },
          { account: 'b', amount: 700, currency: 'USD' },
        ],
      }),
    ).toEqual({ amount: 700, currency: 'USD' });
  });

  it('adds the parts of a split', () => {
    expect(
      amountOf({
        ...expense,
        lines: [
          { account: 'a', amount: -1_000, currency: 'USD' },
          { subcategory: 's', amount: 600, currency: 'USD' },
          { subcategory: 't', amount: 400, currency: 'USD' },
        ],
      }),
    ).toEqual({ amount: 1_000, currency: 'USD' });
  });
});

describe('a corrected amount', () => {
  it('takes both lines of a plain entry, keeping their signs, and changes nothing else', () => {
    const changed = withAmount(expense, 11_250);
    expect(changed?.lines.map((line) => line.amount)).toEqual([-11_250, 11_250]);
    expect(changed).toMatchObject({ payee: 'Power', type: 'expense' });
    expect(expense.lines[1]?.amount).toBe(9_000);
  });

  it('is refused for what is not a plain entry or not an amount', () => {
    for (const amount of [0, -5, 1.5, Number.NaN, 2 ** 60])
      expect(withAmount(expense, amount)).toBeUndefined();
    expect(
      withAmount(
        {
          ...expense,
          lines: [
            { account: 'a', amount: -1_000, currency: 'USD' },
            { subcategory: 's', amount: 600, currency: 'USD' },
            { subcategory: 't', amount: 400, currency: 'USD' },
          ],
        },
        500,
      ),
    ).toBeUndefined();
    expect(
      withAmount(
        {
          ...expense,
          type: 'transfer',
          lines: [
            { account: 'a', amount: -1_000, currency: 'USD' },
            { account: 'b', amount: 900, currency: 'EUR' },
          ],
        },
        500,
      ),
    ).toBeUndefined();
  });
});
