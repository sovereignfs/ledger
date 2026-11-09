import { describe, expect, it } from 'vitest';
import type { EntryLine, ListedEntry } from '../ledger/entry-list';
import { describeEntry } from './present';

const acc = (id: string, name: string, amount: number, currency = 'USD'): EntryLine => ({
  account: { id, name },
  subcategory: null,
  incomeSource: null,
  equity: null,
  amount,
  currency,
});
const sub = (name: string, category: string, amount: number): EntryLine => ({
  account: null,
  subcategory: { id: name, name, category },
  incomeSource: null,
  equity: null,
  amount,
  currency: 'USD',
});
const src = (name: string, amount: number): EntryLine => ({
  account: null,
  subcategory: null,
  incomeSource: { id: name, name },
  equity: null,
  amount,
  currency: 'USD',
});
const eq = (equity: string, amount: number): EntryLine => ({
  account: null,
  subcategory: null,
  incomeSource: null,
  equity,
  amount,
  currency: 'USD',
});
const entry = (
  type: ListedEntry['type'],
  lines: EntryLine[],
  over: Partial<ListedEntry> = {},
): ListedEntry => ({
  id: 'e',
  date: '2026-11-06',
  type,
  status: 'pending',
  note: null,
  payee: null,
  createdAt: 1,
  lines,
  balanceAfter: null,
  ...over,
});

describe('a row of the list', () => {
  it('reads an expense: the payee, the subcategory with its category, the account, and what went out', () => {
    const row = describeEntry(
      entry('expense', [acc('b', 'Bank', -2000), sub('Groceries', 'Food', 2000)], {
        payee: { id: 'p', name: 'Corner Shop' },
        note: 'weekly',
      }),
    );
    expect(row).toMatchObject({
      title: 'Corner Shop',
      category: 'Groceries · Food',
      account: 'Bank',
      amount: -2000,
      currency: 'USD',
      parts: [],
      received: null,
      status: 'pending',
    });
  });

  it('is "Split" when there are parts, and lists them', () => {
    const row = describeEntry(
      entry('expense', [
        acc('b', 'Bank', -8420),
        sub('Groceries', 'Food', 6100),
        sub('Movies', 'Fun', 2320),
      ]),
    );
    expect(row.category).toBe('Split');
    expect(row.parts).toEqual([
      { label: 'Groceries', amount: 6100, currency: 'USD' },
      { label: 'Movies', amount: 2320, currency: 'USD' },
    ]);
    expect(row.amount).toBe(-8420);
  });

  it('falls back from the payee to the note to the kind of entry', () => {
    const lines = [acc('b', 'Bank', -1), sub('S', 'C', 1)];
    expect(describeEntry(entry('expense', lines, { note: 'a note' })).title).toBe('a note');
    expect(describeEntry(entry('expense', lines)).title).toBe('Expense');
    expect(
      describeEntry(entry('expense', lines, { payee: { id: 'p', name: 'P' }, note: 'n' })).title,
    ).toBe('P');
  });

  it('reads an income by its source, and the entries of reconciling and opening by what they are', () => {
    expect(
      describeEntry(entry('income', [acc('b', 'Bank', 5000), src('Salary', -5000)])).category,
    ).toBe('Salary');
    expect(
      describeEntry(entry('opening', [acc('b', 'Bank', 100), eq('opening', -100)])).category,
    ).toBe('Opening balance');
    expect(
      describeEntry(entry('adjustment', [acc('b', 'Bank', 120), eq('adjustment', -120)])).category,
    ).toBe('Adjustment');
    expect(
      describeEntry(entry('revaluation', [acc('f', 'Fund', 500), eq('revaluation', -500)]))
        .category,
    ).toBe('Value updated');
  });

  it('reads a transfer from the account it left to the one it reached, and both amounts when the currencies differ', () => {
    const same = describeEntry(
      entry('transfer', [acc('b', 'Bank', -2500), acc('c', 'Card', 2500)]),
    );
    expect(same).toMatchObject({
      category: 'Transfer',
      account: 'Bank → Card',
      amount: -2500,
      received: null,
    });
    const across = describeEntry(
      entry('transfer', [acc('b', 'Bank', -10000), acc('e', 'Euro', 9000, 'EUR')]),
    );
    expect(across).toMatchObject({
      account: 'Bank → Euro',
      amount: -10000,
      currency: 'USD',
      received: { amount: 9000, currency: 'EUR' },
    });
  });

  it('shows the movement on the one account that is filtered, whichever end of a transfer it is', () => {
    const transfer = entry('transfer', [acc('b', 'Bank', -2500), acc('c', 'Card', 2500)], {
      balanceAfter: 7500,
    });
    expect(describeEntry(transfer, 'b').amount).toBe(-2500);
    expect(describeEntry(transfer, 'c').amount).toBe(2500);
    expect(describeEntry(transfer, 'c').balanceAfter).toBe(7500);
    const across = entry('transfer', [acc('b', 'Bank', -10000), acc('e', 'Euro', 9000, 'EUR')]);
    expect(describeEntry(across, 'e')).toMatchObject({
      amount: 9000,
      currency: 'EUR',
      received: null,
    });
  });

  it('shows both accounts of a loan instalment', () => {
    const row = describeEntry(
      entry('expense', [
        acc('b', 'Bank', -10000),
        acc('l', 'Loan', 9000),
        sub('Interest', 'Loans', 1000),
      ]),
    );
    expect(row.account).toBe('Bank + Loan');
    expect(row.category).toBe('Interest · Loans');
  });
});
