import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { loadOverview } from '../accounts/overview';
import { createIncomeSource } from '../budget/income-sources';
import { testTarget } from '../db/test-support';
import { storeRates } from '../fx/rates';
import { createAccount } from '../ledger/accounts';
import { ensureBook, findBook, type Book } from '../ledger/books';
import { revalue } from '../ledger/revalue';
import { createTransaction } from '../ledger/transactions';
import { RateTable } from '../money/convert';
import { setupCurrency } from '../setup/setup';
import {
  type Movement,
  loadNetWorthSeries,
  monthEnds,
  netWorthAt,
  netWorthSeries,
} from './net-worth';

const { leg } = testTarget();
const NOW = new Date('2026-04-15T12:00:00Z');

describe('the dates of a series (pure)', () => {
  it('is the month ends up to this month, which is today, ascending', () => {
    expect(monthEnds('2026-04-15', 3)).toEqual(['2026-02-28', '2026-03-31', '2026-04-15']);
    expect(monthEnds('2028-03-10', 2)).toEqual(['2028-02-29', '2028-03-10']);
    expect(monthEnds('2026-01-31', 2)).toEqual(['2025-12-31', '2026-01-31']);
    expect(monthEnds('2026-04-15', 24)).toHaveLength(24);
  });
});

describe('a series from the lines (pure)', () => {
  const none = new RateTable('2026-01-01', '2026-12-31', []);
  const move = (accountId: string, date: string, amount: number, currency = 'USD'): Movement => ({
    accountId,
    currency,
    date,
    amount,
  });

  it('runs the balances forward through the dates in one pass, whatever order the lines come in', () => {
    const lines = [
      move('a', '2026-03-05', -300),
      move('a', '2026-01-02', 1_000),
      move('b', '2026-02-10', 500),
    ];
    const forward = netWorthSeries({
      movements: lines,
      dates: ['2026-01-31', '2026-02-28', '2026-03-31'],
      base: 'USD',
      rates: none,
    });
    const backward = netWorthSeries({
      movements: [...lines].reverse(),
      dates: ['2026-01-31', '2026-02-28', '2026-03-31'],
      base: 'USD',
      rates: none,
    });
    expect(forward.map((p) => p.total)).toEqual([1_000, 1_500, 1_200]);
    expect(backward).toEqual(forward);
  });

  it('counts a line dated on the day itself, and not one dated the day after', () => {
    const points = netWorthSeries({
      movements: [move('a', '2026-01-31', 400), move('a', '2026-02-01', 100)],
      dates: ['2026-01-31', '2026-02-28'],
      base: 'USD',
      rates: none,
    });
    expect(points.map((p) => p.total)).toEqual([400, 500]);
  });

  it('keeps what is above nothing as assets and what is below as liabilities, which add up to the total', () => {
    const [point] = netWorthSeries({
      movements: [move('bank', '2026-01-02', 1_000), move('loan', '2026-01-02', -400)],
      dates: ['2026-01-31'],
      base: 'USD',
      rates: none,
    });
    expect(point?.assets.amount).toBe(1_000);
    expect(point?.liabilities.amount).toBe(-400);
    expect(point?.total).toBe(600);
  });

  it('counts nothing before an account has its first line, and a date before everything is nothing', () => {
    const [early, late] = netWorthSeries({
      movements: [move('a', '2026-02-10', 700)],
      dates: ['2026-01-31', '2026-02-28'],
      base: 'USD',
      rates: none,
    });
    expect(early?.total).toBe(0);
    expect(late?.total).toBe(700);
  });

  it('leaves out what has no rate and says so, and does not count it as nothing', () => {
    const [point] = netWorthSeries({
      movements: [move('a', '2026-01-02', 1_000), move('f', '2026-01-02', 5_000, 'CHF')],
      dates: ['2026-01-31'],
      base: 'USD',
      rates: none,
    });
    expect(point?.total).toBe(1_000);
    expect(point?.assets.notIncluded).toEqual([{ currency: 'CHF', count: 1, amount: 5_000 }]);
  });
});

let t: TwoAccounts;
let book: Book;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  const id = t.ada.id;
  book = (await findBook(t.database, id)) as Book;
  const b = book.id;
  const okay = <T extends { ok: boolean }>(result: T) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  };
  await setupCurrency(t.database, id, b, { currency: 'USD', timeZone: 'UTC' }, NOW.getTime());
  // A euro is 1.25 dollars until the end of February, and a dollar from March.
  await storeRates(t.database, '2026-01-01', new Map([['EUR', '0.8']]), 1);
  await storeRates(t.database, '2026-03-01', new Map([['EUR', '1.0']]), 1);
  const open = (amount: number) => ({ amount, date: '2026-01-01' });
  const bank = okay(
    await createAccount(t.database, id, b, {
      type: 'bank',
      name: 'Bank',
      currency: 'USD',
      opening: open(100_000),
    }),
  ).id;
  okay(
    await createAccount(t.database, id, b, {
      type: 'bank',
      name: 'Euros',
      currency: 'EUR',
      opening: open(80_000),
    }),
  );
  const brokerage = okay(
    await createAccount(t.database, id, b, {
      type: 'investment',
      name: 'Brokerage',
      currency: 'USD',
      opening: open(200_000),
    }),
  ).id;
  okay(
    await createAccount(t.database, id, b, {
      type: 'loan',
      name: 'Loan',
      currency: 'USD',
      opening: open(-50_000),
      loan: {
        lender: 'L',
        principal: 50_000,
        startDate: '2026-01-01',
        endDate: '2030-01-01',
        instalment: 1_000,
        yearlyRate: null,
        interestSubcategoryId: null,
      },
    }),
  );
  const pay = okay(await createIncomeSource(t.database, id, b, { name: 'Pay' })).id;
  okay(
    await createTransaction(t.database, id, b, {
      type: 'income',
      date: '2026-02-10',
      lines: [
        { account: bank, amount: 50_000, currency: 'USD' },
        { incomeSource: pay, amount: -50_000, currency: 'USD' },
      ],
    }),
  );
  okay(await revalue(t.database, id, b, brokerage, { date: '2026-02-15', value: 230_000 }));
  book = (await findBook(t.database, id)) as Book;
}, 120_000);
afterAll(async () => t.close());

describe(`net worth over time, worked by hand (${leg})`, () => {
  it('has, at the end of each month: 3,500 in January, 4,300 in February (income and a revaluation), 4,100 in March (the euro fell)', async () => {
    const series = (await loadNetWorthSeries(t.database, t.ada.id, book, 4, NOW)) as NonNullable<
      Awaited<ReturnType<typeof loadNetWorthSeries>>
    >;
    expect(series.map((p) => p.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-15',
    ]);
    // January: bank 1,000 + 800 euros at 1.25 (1,000) + brokerage 2,000 = 4,000 of assets, 500 owed.
    expect(series[0]).toMatchObject({ total: 350_000 });
    expect(series[0]?.assets.amount).toBe(400_000);
    expect(series[0]?.liabilities.amount).toBe(-50_000);
    // February: bank 1,500, euros 1,000, brokerage worth 2,300.
    expect(series[1]).toMatchObject({ total: 430_000 });
    // March: the 800 euros are 800 dollars now.
    expect(series[2]).toMatchObject({ total: 410_000 });
    expect(series[2]?.assets.amount).toBe(460_000);
    // Today is as March ended.
    expect(series[3]?.total).toBe(410_000);
  });

  it('agrees with net worth on one day, and with the Accounts screen today', async () => {
    const series = (await loadNetWorthSeries(t.database, t.ada.id, book, 24, NOW)) as NonNullable<
      Awaited<ReturnType<typeof loadNetWorthSeries>>
    >;
    expect(series).toHaveLength(24);
    for (const point of [series[0], series[19], series[21], series[22], series[23]]) {
      const alone = await netWorthAt(t.database, t.ada.id, book, point?.date as string);
      expect(alone?.total, point?.date).toBe(point?.total);
      expect(alone?.assets.amount).toBe(point?.assets.amount);
    }
    const accounts = await loadOverview(t.database, t.ada.id, book, NOW);
    expect(series[23]?.total).toBe(accounts.netWorth.total?.amount);
    // Before anything existed: nothing.
    expect(series[0]?.total).toBe(0);
  });

  it('is nothing for a book with no base currency, and for another person, nothing at all', async () => {
    const hers = (await findBook(t.database, t.grace.id)) as Book;
    expect(await loadNetWorthSeries(t.database, t.grace.id, hers, 3, NOW)).toBeNull();
    const theirs = (await loadNetWorthSeries(
      t.database,
      t.grace.id,
      { ...hers, id: book.id, baseCurrency: 'USD' },
      3,
      NOW,
    )) as NonNullable<Awaited<ReturnType<typeof loadNetWorthSeries>>>;
    expect(theirs.map((p) => p.total)).toEqual([0, 0, 0]);
  });
});
