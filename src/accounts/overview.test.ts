import { describe, expect, it } from 'vitest';
import type { AccountRow } from '../ledger/accounts';
import type { AccountType } from '../ledger/account-types';
import { RateTable } from '../money/convert';
import { groupAccounts, netWorth } from './overview';

const row = (
  type: AccountType,
  currency: string,
  balance: number,
  name: string = type,
): AccountRow => ({
  id: `${name}-${currency}`,
  type,
  name,
  institution: null,
  currency,
  creditLimit: null,
  position: 0,
  archivedAt: null,
  balance,
  loan: null,
  deletable: true,
});

describe('grouping accounts', () => {
  it('puts what you have, what you owe and people in their own groups, in the order they were made, and leaves out an empty one', () => {
    const rows = [
      row('bank', 'USD', 1, 'b1'),
      row('credit_card', 'USD', -1, 'c'),
      row('cash', 'USD', 1, 'b2'),
      row('loan', 'USD', -1, 'l'),
    ];
    expect(groupAccounts(rows).map((g) => [g.id, g.accounts.map((a) => a.name)])).toEqual([
      ['assets', ['b1', 'b2']],
      ['liabilities', ['c', 'l']],
    ]);
    expect(groupAccounts([row('person', 'USD', 5, 'p')]).map((g) => g.id)).toEqual(['people']);
    expect(groupAccounts([])).toEqual([]);
  });
});

describe('net worth', () => {
  const day = '2026-11-09';
  const rates = new RateTable(day, day, [
    { currency: 'EUR', asOf: '2026-11-06', rate: '0.9' },
    { currency: 'JPY', asOf: '2026-11-06', rate: '150' },
  ]);

  it('adds every balance in the base currency, so that what is owed comes off', () => {
    const rows = [
      row('bank', 'USD', 100000),
      row('savings', 'EUR', 90000), // 900.00 EUR at 0.9 is 1000.00 USD
      row('credit_card', 'USD', -25000),
      row('loan', 'EUR', -45000), // 450.00 EUR is 500.00 USD
      row('person', 'USD', 2000),
    ];
    const worth = netWorth(rows, 'USD', rates, day);
    expect(worth.total).toEqual({
      currency: 'USD',
      amount: 100000 + 100000 - 25000 - 50000 + 2000,
      included: 5,
      notIncluded: [],
    });
    expect(worth.byCurrency).toEqual([]);
  });

  it('says what it left out for want of a rate, and never counts it as nothing', () => {
    const worth = netWorth(
      [
        row('bank', 'USD', 5000),
        row('bank', 'CHF', 99900, 'swiss'),
        row('cash', 'CHF', 100, 'chf cash'),
      ],
      'USD',
      rates,
      day,
    );
    expect(worth.total).toMatchObject({
      amount: 5000,
      included: 1,
      notIncluded: [{ currency: 'CHF', count: 2, amount: 100000 }],
    });
  });

  it('is in the base currency whichever it is, and an account in it needs no rate', () => {
    const worth = netWorth([row('bank', 'EUR', 9000), row('bank', 'USD', 1000)], 'EUR', rates, day);
    expect(worth.total).toMatchObject({ currency: 'EUR', amount: 9000 + 900 });
  });

  it('is one total for each currency while the book has no base currency, and converts nothing', () => {
    const worth = netWorth(
      [row('bank', 'USD', 1000), row('credit_card', 'USD', -400), row('bank', 'EUR', 500)],
      null,
      rates,
      day,
    );
    expect(worth.total).toBeNull();
    expect(worth.byCurrency).toEqual([
      { currency: 'EUR', amount: 500 },
      { currency: 'USD', amount: 600 },
    ]);
  });

  it('is nothing for no accounts', () => {
    expect(netWorth([], 'USD', rates, day).total).toEqual({
      currency: 'USD',
      amount: 0,
      included: 0,
      notIncluded: [],
    });
    expect(netWorth([], null, rates, day).byCurrency).toEqual([]);
  });
});
