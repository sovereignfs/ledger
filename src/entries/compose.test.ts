import { describe, expect, it } from 'vitest';
import { checkShape } from '../ledger/validate';
import { type EntryForm, compose, editable, formOf, missing } from './compose';

const form = (over: Partial<EntryForm> = {}): EntryForm => ({
  type: 'expense',
  amount: 1250,
  accountId: 'bank',
  currency: 'USD',
  targetId: 'food',
  date: '2026-11-06',
  note: '',
  ...over,
});

describe('what the form means', () => {
  it('is the account down and the subcategory up for an expense, which adds up', () => {
    const entry = compose(form({ note: '  lunch  ' }));
    expect(entry).toEqual({
      type: 'expense',
      date: '2026-11-06',
      lines: [
        { account: 'bank', amount: -1250, currency: 'USD' },
        { subcategory: 'food', amount: 1250, currency: 'USD' },
      ],
      note: 'lunch',
    });
    expect(checkShape(entry)).toEqual([]);
  });

  it('is the account up and the income source down for an income, which adds up', () => {
    const entry = compose(
      form({ type: 'income', targetId: 'pay', amount: 300000, currency: 'JPY' }),
    );
    expect(entry.lines).toEqual([
      { account: 'bank', amount: 300000, currency: 'JPY' },
      { incomeSource: 'pay', amount: -300000, currency: 'JPY' },
    ]);
    expect(checkShape(entry)).toEqual([]);
    expect(compose(form()).note).toBeNull();
  });

  it('says what is missing, in the order a person fills it in', () => {
    expect(missing(form())).toBeUndefined();
    expect(missing(form({ accountId: '' }))).toBe('Choose the account.');
    expect(missing(form({ amount: null }))).toBe('Enter the amount.');
    expect(missing(form({ amount: 0 }))).toBe('Enter the amount.');
    expect(missing(form({ targetId: '' }))).toBe('Choose the subcategory.');
    expect(missing(form({ type: 'income', targetId: '' }))).toBe('Choose the income source.');
    expect(missing(form({ date: '' }))).toBe('Enter the date.');
  });
});

describe('an entry read back', () => {
  const read = (
    type: string,
    lines: Parameters<typeof editable>[0]['lines'],
    original: unknown = null,
  ) => ({
    type,
    original,
    lines,
  });

  it('is editable when it is an expense or an income of an account and its target, and becomes the form that made it', () => {
    const expense = read('expense', [
      { account: 'bank', amount: -1250, currency: 'USD' },
      { subcategory: 'food', amount: 1250, currency: 'USD' },
    ]);
    expect(editable(expense)).toBe(true);
    expect(formOf({ ...expense, date: '2026-11-06', note: 'lunch' })).toEqual(
      form({ note: 'lunch' }),
    );
    const income = read('income', [
      { account: 'bank', amount: 500, currency: 'USD' },
      { incomeSource: 'pay', amount: -500, currency: 'USD' },
    ]);
    expect(editable(income)).toBe(true);
    expect(formOf({ ...income, date: '2026-11-06', note: null })).toMatchObject({
      type: 'income',
      amount: 500,
      targetId: 'pay',
    });
  });

  it('is not editable here when it has parts, two accounts, an original amount or is of another kind', () => {
    const split = read('expense', [
      { account: 'bank', amount: -100, currency: 'USD' },
      { subcategory: 'a', amount: 60, currency: 'USD' },
      { subcategory: 'b', amount: 40, currency: 'USD' },
    ]);
    expect(editable(split)).toBe(false);
    expect(
      editable(
        read('transfer', [
          { account: 'a', amount: -1, currency: 'USD' },
          { account: 'b', amount: 1, currency: 'USD' },
        ]),
      ),
    ).toBe(false);
    expect(
      editable(
        read('opening', [
          { account: 'a', amount: 1, currency: 'USD' },
          { equity: 'opening', amount: -1, currency: 'USD' },
        ]),
      ),
    ).toBe(false);
    expect(
      editable(
        read(
          'expense',
          [
            { account: 'a', amount: -1, currency: 'USD' },
            { subcategory: 's', amount: 1, currency: 'USD' },
          ],
          { amount: 5, currency: 'EUR' },
        ),
      ),
    ).toBe(false);
  });
});
