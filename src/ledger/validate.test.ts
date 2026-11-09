import { describe, expect, it } from 'vitest';
import {
  type LineInput,
  type TxnInput,
  checkAccounts,
  checkShape,
  defaultStatus,
  targetOf,
} from './validate';

const acc = (account: string, amount: number, currency = 'USD'): LineInput => ({
  account,
  amount,
  currency,
});
const sub = (subcategory: string, amount: number, currency = 'USD'): LineInput => ({
  subcategory,
  amount,
  currency,
});
const src = (incomeSource: string, amount: number, currency = 'USD'): LineInput => ({
  incomeSource,
  amount,
  currency,
});
const eq = (equity: 'opening' | 'adjustment' | 'revaluation', amount: number): LineInput => ({
  equity,
  amount,
  currency: 'USD',
});
const entry = (
  type: TxnInput['type'],
  lines: LineInput[],
  more: Partial<TxnInput> = {},
): TxnInput => ({
  type,
  date: '2026-11-06',
  lines,
  ...more,
});

describe('a line names exactly one target', () => {
  it('knows which', () => {
    expect(targetOf(acc('a', 1))).toBe('account');
    expect(targetOf(sub('s', 1))).toBe('subcategory');
    expect(targetOf(src('i', 1))).toBe('income_source');
    expect(targetOf(eq('opening', 1))).toBe('equity');
  });

  it('is refused for none and for two, in a sentence', () => {
    expect(targetOf({ amount: 1, currency: 'USD' })).toBeUndefined();
    expect(
      targetOf({ account: 'a', subcategory: 's', amount: 1, currency: 'USD' }),
    ).toBeUndefined();
    const none = checkShape(entry('expense', [acc('a', -100), { amount: 100, currency: 'USD' }]));
    expect(none).toEqual([
      'Each line names exactly one of an account, a subcategory, an income source or equity.',
    ]);
    const two = checkShape(
      entry('expense', [
        acc('a', -100),
        { subcategory: 's', account: 'b', amount: 100, currency: 'USD' },
      ]),
    );
    expect(two[0]).toContain('exactly one');
  });
});

describe('the lines of an entry add up to nothing', () => {
  it('lets an expense through whose parts add up to what was paid, and a refund', () => {
    expect(
      checkShape(entry('expense', [acc('a', -10000), sub('s1', 6667), sub('s2', 3333)])),
    ).toEqual([]);
    expect(checkShape(entry('expense', [acc('a', 2500), sub('s1', -2500)]))).toEqual([]);
  });

  it('refuses one that does not, and says by how much', () => {
    expect(
      checkShape(entry('expense', [acc('a', -10000), sub('s1', 6667), sub('s2', 3332)])),
    ).toEqual([
      'The lines add up to -0.01 USD, and they must add up to nothing: what comes out of one place goes into another.',
    ]);
    expect(checkShape(entry('income', [acc('a', 500), src('i', -400)]))[0]).toContain(
      'add up to 1.00 USD',
    );
    // The currency's own decimals.
    expect(
      checkShape(entry('expense', [acc('a', -1000, 'JPY'), sub('s', 999, 'JPY')]))[0],
    ).toContain('add up to -1 JPY');
    expect(
      checkShape(entry('expense', [acc('a', -1000, 'BHD'), sub('s', 999, 'BHD')]))[0],
    ).toContain('add up to -0.001 BHD');
  });

  it('refuses a mixture of currencies, except in a transfer', () => {
    expect(checkShape(entry('expense', [acc('a', -100), sub('s', 100, 'EUR')]))[0]).toContain(
      'one currency',
    );
    // A transfer of two currencies records both amounts, one down and one up, and they are not added together.
    expect(checkShape(entry('transfer', [acc('a', -10000), acc('b', 9000, 'EUR')]))).toEqual([]);
    expect(checkShape(entry('transfer', [acc('a', -10000), acc('b', -9000, 'EUR')]))[0]).toContain(
      'takes an amount out of one account and puts one into the other',
    );
    // And in one currency it adds up like the others.
    expect(checkShape(entry('transfer', [acc('a', -10000), acc('b', 10000)]))).toEqual([]);
    expect(checkShape(entry('transfer', [acc('a', -10000), acc('b', 9000)]))[0]).toContain(
      'add up to',
    );
  });

  it('refuses a total too large to add up exactly', () => {
    expect(
      checkShape(
        entry('expense', [
          acc('a', Number.MAX_SAFE_INTEGER),
          sub('s', Number.MAX_SAFE_INTEGER),
          sub('t', 1),
        ]),
      )[0],
    ).toContain('too large');
  });
});

describe('an amount and its parts', () => {
  it('is a non-zero whole number, in a currency that is one', () => {
    for (const bad of [0, 12.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(
        checkShape(entry('expense', [acc('a', -100), sub('s', bad)])).length,
        String(bad),
      ).toBeGreaterThan(0);
    expect(
      checkShape(entry('expense', [acc('a', -100, 'BTC'), sub('s', 100, 'BTC')]))[0],
    ).toContain('not one');
    expect(
      checkShape(entry('expense', [acc('a', -100, 'usd'), sub('s', 100, 'usd')]))[0],
    ).toContain('not one');
  });

  it('is refused as a string, as a bigint and as a missing value', () => {
    for (const bad of ['100', 100n, null, undefined])
      expect(
        checkShape(
          entry('expense', [
            acc('a', -100),
            { subcategory: 's', amount: bad as never, currency: 'USD' },
          ]),
        ).length,
        String(bad),
      ).toBeGreaterThan(0);
  });
});

describe('what each type may have', () => {
  it('knows an expense: an account that paid and subcategories, and a second account only to carry what is owed', () => {
    expect(checkShape(entry('expense', [acc('a', -100), sub('s', 100)]))).toEqual([]);
    expect(checkShape(entry('expense', [sub('s', 100), sub('t', -100)]))[0]).toContain(
      'account that paid',
    );
    expect(checkShape(entry('expense', [acc('a', -100), src('i', 100)]))[0]).toContain(
      'account that paid',
    );
    expect(checkShape(entry('expense', [acc('a', -100), eq('opening', 100)]))[0]).toContain(
      'account that paid',
    );
    // A loan instalment: the bank down, the loan up, the interest up.
    expect(
      checkShape(entry('expense', [acc('bank', -10000), acc('loan', 9000), sub('interest', 1000)])),
    ).toEqual([]);
  });

  it('knows an income: one account and income sources', () => {
    expect(checkShape(entry('income', [acc('a', 100), src('i', -100)]))).toEqual([]);
    expect(
      checkShape(entry('income', [acc('a', 100), acc('b', 100), src('i', -200)]))[0],
    ).toContain('one account');
    expect(checkShape(entry('income', [acc('a', 100), sub('s', -100)]))[0]).toContain(
      'one account',
    );
  });

  it('knows a transfer: two different accounts and nothing else', () => {
    expect(checkShape(entry('transfer', [acc('a', -100), acc('a', 100)]))[0]).toContain(
      'two different accounts',
    );
    expect(checkShape(entry('transfer', [acc('a', -100), sub('s', 100)]))[0]).toContain(
      'two accounts',
    );
    expect(
      checkShape(entry('transfer', [acc('a', -100), acc('b', 50), acc('c', 50)]))[0],
    ).toContain('two accounts');
  });

  it('knows an opening, an adjustment and a new value: one account and its own equity', () => {
    for (const type of ['opening', 'adjustment', 'revaluation'] as const) {
      expect(checkShape(entry(type, [acc('a', 500), eq(type, -500)])), type).toEqual([]);
      const other = type === 'opening' ? 'adjustment' : 'opening';
      expect(checkShape(entry(type, [acc('a', 500), eq(other, -500)]))[0], type).toContain(
        'its own',
      );
      expect(checkShape(entry(type, [acc('a', 500), sub('s', -500)]))[0], type).toContain(
        'one account and equity',
      );
    }
  });

  it('refuses a type that is not one, before anything else', () => {
    expect(checkShape(entry('purchase' as never, [acc('a', -1), sub('s', 1)]))).toEqual([
      'The type of the entry is not one there is.',
    ]);
  });
});

describe('the rest of an entry', () => {
  it('has a real day, a note that is not a novel, a status that is one, and at least two lines', () => {
    const lines = [acc('a', -100), sub('s', 100)];
    expect(checkShape(entry('expense', lines, { date: '2026-02-30' }))).toContain(
      'The date is not a day.',
    );
    expect(checkShape(entry('expense', lines, { note: 'x'.repeat(1001) }))[0]).toContain('note');
    expect(checkShape(entry('expense', lines, { note: 'x'.repeat(1000) }))).toEqual([]);
    expect(checkShape(entry('expense', lines, { status: 'done' as never }))[0]).toContain('status');
    expect(checkShape(entry('expense', [acc('a', 0)]))[0]).toContain('at least two lines');
    expect(checkShape(entry('expense', []))[0]).toContain('at least two lines');
    expect(
      checkShape(
        entry(
          'expense',
          Array.from({ length: 101 }, () => sub('s', 1)),
        ),
      ).join(),
    ).toContain('at most 100');
  });

  it('may carry the original amount of an expense or an income and no other', () => {
    const lines = [acc('a', -100, 'EUR'), sub('s', 100, 'EUR')];
    expect(
      checkShape(entry('expense', lines, { original: { amount: 120, currency: 'USD' } })),
    ).toEqual([]);
    expect(
      checkShape(entry('expense', lines, { original: { amount: 0, currency: 'USD' } }))[0],
    ).toContain('original');
    expect(
      checkShape(entry('expense', lines, { original: { amount: 5, currency: 'XXX' } }))[0],
    ).toContain('original');
    expect(
      checkShape(
        entry('transfer', [acc('a', -1), acc('b', 1)], {
          original: { amount: 5, currency: 'USD' },
        }),
      )[0],
    ).toContain('original');
  });

  it('starts pending, except an opening and an adjustment', () => {
    expect(defaultStatus('expense')).toBe('pending');
    expect(defaultStatus('income')).toBe('pending');
    expect(defaultStatus('transfer')).toBe('pending');
    expect(defaultStatus('revaluation')).toBe('pending');
    expect(defaultStatus('opening')).toBe('cleared');
    expect(defaultStatus('adjustment')).toBe('cleared');
  });
});

describe('what the accounts say', () => {
  const accounts = new Map([
    ['bank', { type: 'bank', currency: 'USD' }],
    ['euro', { type: 'bank', currency: 'EUR' }],
    ['loan', { type: 'loan', currency: 'USD' }],
    ['card', { type: 'credit_card', currency: 'USD' }],
    ['cash', { type: 'cash', currency: 'USD' }],
    ['fund', { type: 'investment', currency: 'USD' }],
  ]);

  it('holds a line to its account’s currency', () => {
    expect(
      checkAccounts(entry('expense', [acc('euro', -100), sub('s', 100)]), accounts)[0],
    ).toContain('one currency');
    expect(
      checkAccounts(entry('transfer', [acc('bank', -100), acc('euro', 90, 'EUR')]), accounts),
    ).toEqual([]);
  });

  it('lets an expense carry a second account only if it is a loan or a card', () => {
    const instalment = (second: string) =>
      entry('expense', [acc('bank', -10000), acc(second, 9000), sub('s', 1000)]);
    expect(checkAccounts(instalment('loan'), accounts)).toEqual([]);
    expect(checkAccounts(instalment('card'), accounts)).toEqual([]);
    expect(checkAccounts(instalment('cash'), accounts)[0]).toContain('loan or a credit card');
  });

  it('gives a new value to an investment or a property and to nothing else', () => {
    const value = (account: string) =>
      entry('revaluation', [acc(account, 500), eq('revaluation', -500)]);
    expect(checkAccounts(value('fund'), accounts)).toEqual([]);
    expect(checkAccounts(value('bank'), accounts)[0]).toContain('investment or a property');
  });
});
