import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { setBudget } from '../budget/amounts';
import { createCategory, createSubcategory } from '../budget/categories';
import { createIncomeSource } from '../budget/income-sources';
import { testTarget } from '../db/test-support';
import { storeRates } from '../fx/rates';
import { createAccount } from '../ledger/accounts';
import { ensureBook, findBook, type Book } from '../ledger/books';
import { createTransaction } from '../ledger/transactions';
import { contributeDue } from '../jars/contributions';
import { createJar } from '../jars/jars';
import { setupCurrency } from '../setup/setup';
import {
  type MonthReport,
  buildMonthReport,
  categoriesOf,
  loadMonthList,
  loadMonthReport,
} from './month';

const { leg } = testTarget();
const NOW = new Date('2026-11-09T12:00:00Z');

describe('a category of a month (pure)', () => {
  it('rolls its subcategories up in its own currency, and says by how much it is over', () => {
    const line = (id: string, category: string, budgeted: number | null, spent: number) => ({
      subcategory: { id, name: id, budgetSource: 'manual' as const, archived: false },
      category: { id: category, name: category, currency: 'USD' },
      budgeted,
      spent: { amount: spent, notIncluded: [] },
      over: budgeted !== null && spent > budgeted ? spent - budgeted : 0,
    });
    const budget = {
      month: '2026-10',
      base: 'USD',
      budgeted: null,
      spent: null,
      byCurrency: { budgeted: [], spent: [] },
      groups: [
        {
          id: 'spending' as const,
          title: 'Spending',
          rows: [
            line('a', 'Food', 300, 120),
            line('b', 'Food', 100, 160),
            line('c', 'Fun', null, 50),
          ],
        },
      ],
    };
    const [food, fun] = categoriesOf(budget as never);
    expect(food).toMatchObject({ budgeted: 400, spent: 280, over: 0 });
    expect(fun).toMatchObject({ budgeted: 0, spent: 50, over: 0 });
    // Over: spent more than budgeted in total.
    const [over] = categoriesOf({
      ...budget,
      groups: [{ ...budget.groups[0], rows: [line('a', 'Food', 100, 160)] }],
    } as never);
    expect(over?.over).toBe(60);
  });

  it('is nothing at all for a book with no month', () => {
    const empty = buildMonthReport({
      month: '2026-10',
      base: null,
      income: {
        month: '2026-10',
        rows: [],
        base: null,
        budgeted: null,
        received: null,
        byCurrency: { budgeted: [], received: [] },
      },
      budget: {
        month: '2026-10',
        groups: [],
        base: null,
        budgeted: null,
        spent: null,
        byCurrency: { budgeted: [], spent: [] },
      },
      jarContributions: [],
      accounts: [],
      loanPaid: new Map(),
      rates: { rateOn: () => undefined } as never,
      asOf: '2026-10-31',
    });
    expect(empty.savings).toEqual({ projected: null, actual: null, afterJars: null });
    expect(empty.people).toBeNull();
    expect(empty.categories).toEqual([]);
  });
});

let t: TwoAccounts;
let book: Book;
let report: MonthReport;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  book = (await findBook(t.database, t.ada.id)) as Book;
  const id = t.ada.id;
  const b = book.id;
  const okay = <T extends { ok: boolean }>(result: T) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  };
  await setupCurrency(t.database, id, b, { currency: 'USD', timeZone: 'UTC' }, NOW.getTime());
  // One euro is 1.25 dollars from the start of October.
  await storeRates(t.database, '2026-10-01', new Map([['EUR', '0.8']]), 1);
  const acct = async (
    type: 'bank' | 'savings' | 'person' | 'credit_card',
    name: string,
    currency: string,
    amount: number,
    creditLimit?: number,
  ) =>
    okay(
      await createAccount(
        t.database,
        id,
        b,
        {
          type,
          name,
          currency,
          opening: amount ? { amount, date: '2026-01-01' } : null,
          ...(creditLimit ? { creditLimit } : {}),
        },
        NOW.getTime(),
      ),
    ).id;
  const bank = await acct('bank', 'Bank', 'USD', 1_000_000);
  const euros = await acct('bank', 'Euros', 'EUR', 100_000);
  const savings = await acct('savings', 'Savings', 'USD', 1_000_000);
  const alex = await acct('person', 'Alex', 'USD', 0);
  const card = await acct('credit_card', 'Card', 'USD', 0, 300_000);
  const loan = okay(
    await createAccount(
      t.database,
      id,
      b,
      {
        type: 'loan',
        name: 'Loan',
        currency: 'USD',
        opening: { amount: -500_000, date: '2026-01-01' },
        loan: {
          lender: 'Lender',
          principal: 500_000,
          startDate: '2026-01-01',
          endDate: '2030-01-01',
          instalment: 20_000,
          yearlyRate: null,
          interestSubcategoryId: null,
        },
      },
      NOW.getTime(),
    ),
  ).id;
  const salary = okay(await createIncomeSource(t.database, id, b, { name: 'Salary' })).id;
  const side = okay(
    await createIncomeSource(t.database, id, b, {
      name: 'Side',
      kind: 'secondary',
      currency: 'EUR',
    }),
  ).id;
  const house = okay(await createCategory(t.database, id, b, { name: 'House' })).id;
  const rent = okay(await createSubcategory(t.database, id, b, house, { name: 'Rent' })).id;
  const food = okay(await createSubcategory(t.database, id, b, house, { name: 'Groceries' })).id;
  await setBudget(t.database, id, b, {
    kind: 'subcategory',
    targetId: rent,
    amount: 100_000,
    when: 'this',
    currentMonth: '2026-09',
  });
  await setBudget(t.database, id, b, {
    kind: 'subcategory',
    targetId: food,
    amount: 30_000,
    when: 'this',
    currentMonth: '2026-09',
  });
  await setBudget(t.database, id, b, {
    kind: 'income',
    targetId: salary,
    amount: 300_000,
    when: 'this',
    currentMonth: '2026-09',
  });
  const write = async (
    type: 'expense' | 'income' | 'transfer',
    date: string,
    lines: never[] | unknown[],
  ) =>
    okay(
      await createTransaction(
        t.database,
        id,
        b,
        { type, date, lines: lines as never },
        NOW.getTime(),
      ),
    );
  // Income: 3,000 dollars, and 400 euros which is 500 dollars.
  await write('income', '2026-10-01', [
    { account: bank, amount: 300_000, currency: 'USD' },
    { incomeSource: salary, amount: -300_000, currency: 'USD' },
  ]);
  await write('income', '2026-10-15', [
    { account: euros, amount: 40_000, currency: 'EUR' },
    { incomeSource: side, amount: -40_000, currency: 'EUR' },
  ]);
  // Spending: rent 1,000, groceries 120, and 80 euros of groceries which is 100 dollars.
  await write('expense', '2026-10-02', [
    { account: bank, amount: -100_000, currency: 'USD' },
    { subcategory: rent, amount: 100_000, currency: 'USD' },
  ]);
  await write('expense', '2026-10-05', [
    { account: card, amount: -12_000, currency: 'USD' },
    { subcategory: food, amount: 12_000, currency: 'USD' },
  ]);
  await write('expense', '2026-10-10', [
    { account: euros, amount: -8_000, currency: 'EUR' },
    { subcategory: food, amount: 8_000, currency: 'EUR' },
  ]);
  // Money lent: not spending.
  await write('transfer', '2026-10-12', [
    { account: bank, amount: -10_000, currency: 'USD' },
    { account: alex, amount: 10_000, currency: 'USD' },
  ]);
  // The loan: 200 an instalment with no rate is all principal; with a rate part of it is interest. Here 150 off the loan and 50 of interest, by hand.
  const interest = okay(
    await createSubcategory(t.database, id, b, house, { name: 'Loan interest' }),
  ).id;
  await write('expense', '2026-10-20', [
    { account: bank, amount: -20_000, currency: 'USD' },
    { account: loan, amount: 15_000, currency: 'USD' },
    { subcategory: interest, amount: 5_000, currency: 'USD' },
  ]);
  // A jar: 150 a month, earmarked on the 2nd of October.
  const jar = okay(
    await createJar(
      t.database,
      id,
      b,
      { accountId: savings, name: 'Trip', monthly: 15_000 },
      '2026-09',
      new Date('2026-09-10T12:00:00Z').getTime(),
    ),
  );
  expect(jar.id).toBeTruthy();
  await contributeDue(t.database, new Date('2026-10-02T12:00:00Z'));
  book = (await findBook(t.database, id)) as Book;
  report = await loadMonthReport(t.database, id, book, '2026-10', NOW);
}, 120_000);
afterAll(async () => t.close());

describe(`a month's report, worked by hand (${leg})`, () => {
  it('has income received of 3,500 dollars (3,000 and 400 euros at 1.25) against 3,000 budgeted', () => {
    expect(report.income.received?.amount).toBe(350_000);
    expect(report.income.budgeted?.amount).toBe(300_000);
  });

  it('has spent 1,270: rent 1,000, groceries 120 and 80 euros (100), and the loan’s interest 50, but not its principal and not money lent', () => {
    expect(report.budget.spent?.amount).toBe(127_000);
    const house = report.categories.find((c) => c.name === 'House');
    expect(house).toMatchObject({ spent: 127_000, budgeted: 130_000, over: 0 });
    expect(house?.rows.find((r) => r.subcategory.name === 'Loan interest')?.spent.amount).toBe(
      5_000,
    );
    expect(report.budget.budgeted?.amount).toBe(130_000);
  });

  it('has the three savings figures: projected 1,700, actual 2,230 and 2,080 after the 150 earmarked in the jar', () => {
    expect(report.savings).toEqual({ projected: 170_000, actual: 223_000, afterJars: 208_000 });
    expect(report.jars?.amount).toBe(15_000);
  });

  it('summarises the loan (4,850 left, 150 paid), the card (120 used of 3,000), and 100 owed to you by a person', () => {
    expect(report.loans).toEqual([
      { id: expect.any(String), name: 'Loan', currency: 'USD', left: 485_000, paid: 15_000 },
    ]);
    expect(report.cards).toEqual([
      { id: expect.any(String), name: 'Card', currency: 'USD', used: 12_000, limit: 300_000 },
    ]);
    expect(report.people?.owedToYou.amount).toBe(10_000);
    expect(report.people?.youOwe.amount).toBe(0);
    expect(report.notIncluded).toEqual([]);
  });

  it('lists the months with what was received and spent, the current one in progress, newest first, in two reads', async () => {
    const list = await loadMonthList(t.database, t.ada.id, book, NOW);
    expect(list.map((line) => [line.month, line.inProgress])).toEqual([
      ['2026-11', true],
      ['2026-10', false],
      ['2026-09', false],
      ['2026-08', false],
      ['2026-07', false],
      ['2026-06', false],
      ['2026-05', false],
      ['2026-04', false],
      ['2026-03', false],
      ['2026-02', false],
      ['2026-01', false],
    ]);
    const october = list.find((line) => line.month === '2026-10');
    expect(october).toMatchObject({ saved: 223_000 });
    expect(october?.received?.amount).toBe(350_000);
    expect(october?.spent?.amount).toBe(127_000);
    // Another month has none of October's: the opening of the loan in January is not paid off, and November has received and spent nothing yet.
    expect(list.find((line) => line.month === '2026-11')?.received?.amount).toBe(0);
    expect(list.find((line) => line.month === '2026-09')?.spent?.amount).toBe(0);
    const january = await loadMonthReport(t.database, t.ada.id, book, '2026-01', NOW);
    expect(january.loans[0]?.paid).toBe(0);
  });

  it('is empty for another person, who has no month at all', async () => {
    const hers = (await findBook(t.database, t.grace.id)) as Book;
    expect(await loadMonthList(t.database, t.grace.id, hers, NOW)).toEqual([]);
    const theirs = await loadMonthReport(
      t.database,
      t.grace.id,
      { ...hers, id: book.id },
      '2026-10',
      NOW,
    );
    expect(theirs.income.received?.amount ?? 0).toBe(0);
    expect(theirs.categories).toEqual([]);
    expect(theirs.loans).toEqual([]);
  });

  it('says what it left out for want of a rate, and does not count it as nothing', async () => {
    await createAccount(
      t.database,
      t.ada.id,
      book.id,
      {
        type: 'bank',
        name: 'Swiss',
        currency: 'CHF',
        opening: { amount: 5_000, date: '2026-01-01' },
      },
      NOW.getTime(),
    );
    const { createIncomeSource: makeSource } = await import('../budget/income-sources');
    const chf = await makeSource(t.database, t.ada.id, book.id, {
      name: 'Swiss pay',
      kind: 'secondary',
      currency: 'CHF',
    });
    expect(chf.ok).toBe(true);
    const accounts = await (
      await import('../ledger/accounts')
    ).listAccounts(t.database, t.ada.id, book.id);
    const swiss = accounts.find((a) => a.currency === 'CHF')?.id as string;
    await createTransaction(
      t.database,
      t.ada.id,
      book.id,
      {
        type: 'income',
        date: '2026-10-25',
        lines: [
          { account: swiss, amount: 7_000, currency: 'CHF' },
          { incomeSource: chf.ok ? chf.id : '', amount: -7_000, currency: 'CHF' },
        ],
      },
      NOW.getTime(),
    );
    const again = await loadMonthReport(t.database, t.ada.id, book, '2026-10', NOW);
    expect(again.notIncluded.join(' ')).toContain('CHF');
    // The figure is what could be converted, and the amount left out is named: received is not 3,500 plus nothing silently.
    expect(again.income.received?.amount).toBe(350_000);
    expect(again.income.received?.notIncluded[0]).toMatchObject({ currency: 'CHF', amount: 7_000 });
  });
});
