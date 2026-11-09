import { describe, expect, it } from 'vitest';
import { checkShape } from '../ledger/validate';
import { type EntryForm, compose, editable, formOf, missing, remainder } from './compose';

const form = (over: Partial<EntryForm> = {}): EntryForm => ({
  type: 'expense',
  amount: 1250,
  accountId: 'bank',
  currency: 'USD',
  targetId: 'food',
  split: false,
  parts: [],
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

  it('is not editable here when it has two accounts, an original amount, a mixture of targets or is of another kind', () => {
    const line = (over: object) => ({ amount: 1, currency: 'USD', ...over });
    expect(editable(read('transfer', [line({ account: 'a' }), line({ account: 'b' })]))).toBe(
      false,
    );
    expect(editable(read('opening', [line({ account: 'a' }), line({ equity: 'opening' })]))).toBe(
      false,
    );
    expect(
      editable(
        read('expense', [line({ account: 'a' }), line({ subcategory: 's' })], {
          amount: 5,
          currency: 'EUR',
        }),
      ),
    ).toBe(false);
    // A loan instalment has a second account; an expense on an income source is not one.
    expect(
      editable(
        read('expense', [
          line({ account: 'a' }),
          line({ account: 'loan' }),
          line({ subcategory: 's' }),
        ]),
      ),
    ).toBe(false);
    expect(editable(read('expense', [line({ account: 'a' }), line({ incomeSource: 'i' })]))).toBe(
      false,
    );
    expect(editable(read('expense', [line({ account: 'a' })]))).toBe(false);
  });

  it('is editable with parts, and becomes a split of the same parts', () => {
    const split = read('expense', [
      { account: 'bank', amount: -8420, currency: 'USD' },
      { subcategory: 'a', amount: 6100, currency: 'USD' },
      { subcategory: 'b', amount: 2320, currency: 'USD' },
    ]);
    expect(editable(split)).toBe(true);
    expect(formOf({ ...split, date: '2026-11-06', note: null })).toMatchObject({
      split: true,
      amount: 8420,
      targetId: '',
      parts: [
        { targetId: 'a', amount: 6100 },
        { targetId: 'b', amount: 2320 },
      ],
    });
  });
});

describe('a split', () => {
  const parted = (
    parts: { targetId: string; amount: number | null }[],
    over: Partial<EntryForm> = {},
  ) => form({ amount: 8420, split: true, targetId: '', parts, ...over });

  it('is the account down by the whole and a line for each part, which adds up: 84.20 as 61.00 and 23.20', () => {
    const entry = compose(
      parted([
        { targetId: 'a', amount: 6100 },
        { targetId: 'b', amount: 2320 },
      ]),
    );
    expect(entry.lines).toEqual([
      { account: 'bank', amount: -8420, currency: 'USD' },
      { subcategory: 'a', amount: 6100, currency: 'USD' },
      { subcategory: 'b', amount: 2320, currency: 'USD' },
    ]);
    expect(checkShape(entry)).toEqual([]);
    const income = compose(
      parted(
        [
          { targetId: 'p', amount: 5000 },
          { targetId: 'q', amount: 3420 },
        ],
        { type: 'income' },
      ),
    );
    expect(income.lines.map((l) => l.amount)).toEqual([8420, -5000, -3420]);
    expect(checkShape(income)).toEqual([]);
  });

  it('shows what is left, and is refused with a sentence while there is any, before it is sent', () => {
    const short = parted([
      { targetId: 'a', amount: 6100 },
      { targetId: 'b', amount: 2000 },
    ]);
    expect(remainder(short)).toBe(320);
    expect(missing(short)).toBe('The parts are 3.20 USD short: they must add up to the amount.');
    const over = parted([
      { targetId: 'a', amount: 6100 },
      { targetId: 'b', amount: 2500 },
    ]);
    expect(remainder(over)).toBe(-180);
    expect(missing(over)).toBe('The parts are 1.80 USD over: they must add up to the amount.');
    expect(
      missing(
        parted([
          { targetId: 'a', amount: 6100 },
          { targetId: 'b', amount: 2320 },
        ]),
      ),
    ).toBeUndefined();
    // The currency's own decimals.
    expect(
      missing(
        parted(
          [
            { targetId: 'a', amount: 600 },
            { targetId: 'b', amount: 300 },
          ],
          { amount: 1000, currency: 'JPY' },
        ),
      ),
    ).toBe('The parts are 100 JPY short: they must add up to the amount.');
  });

  it('needs at least two parts, a target and an amount for each', () => {
    expect(missing(parted([{ targetId: 'a', amount: 8420 }]))).toBe(
      'A split has at least two parts.',
    );
    expect(
      missing(
        parted([
          { targetId: 'a', amount: 8420 },
          { targetId: '', amount: 0 },
        ]),
      ),
    ).toBe('Choose the subcategory of each part.');
    expect(
      missing(
        parted([
          { targetId: 'a', amount: 8420 },
          { targetId: 'b', amount: null },
        ]),
      ),
    ).toBe('Enter the amount of each part.');
    expect(
      missing(
        parted([
          { targetId: 'a', amount: 8420 },
          { targetId: 'b', amount: 0 },
        ]),
      ),
    ).toBe('Enter the amount of each part.');
    expect(
      missing(
        parted(
          [
            { targetId: 'a', amount: 1 },
            { targetId: '', amount: 1 },
          ],
          { type: 'income' },
        ),
      ),
    ).toBe('Choose the income source of each part.');
  });
});
