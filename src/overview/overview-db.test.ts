import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { setBudget } from '../budget/amounts';
import { createCategory, createSubcategory } from '../budget/categories';
import { createIncomeSource } from '../budget/income-sources';
import { loadBudget } from '../budget/screen';
import { loadIncome } from '../budget/income';
import { monthOf, todayIn } from '../dates';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { type Book, ensureBook, findBook } from '../ledger/books';
import { createTransaction } from '../ledger/transactions';
import { loadOverviewPage } from './overview';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let book: Book;
const NOW = new Date('2026-11-20T12:00:00Z');
const MONTH = monthOf(todayIn('UTC', NOW));
let bank: string;
let groceries: string;
let fun: string;
let pay: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  await dbAll(
    t.database,
    sql`UPDATE ${tableNamed(t.database, 'book')} SET base_currency = 'USD' WHERE id = ${adas} RETURNING id`,
  );
  book = (await findBook(t.database, t.ada.id)) as Book;
  const account = await createAccount(t.database, t.ada.id, adas, {
    type: 'bank',
    name: 'Bank',
    currency: 'USD',
    opening: { amount: 1_000_000, date: '2026-01-01' },
  });
  if (!account.ok) throw new Error('account');
  bank = account.id;
  const food = await createCategory(t.database, t.ada.id, adas, { name: 'Food' });
  if (!food.ok) throw new Error('category');
  const g = await createSubcategory(t.database, t.ada.id, adas, food.id, { name: 'Groceries' });
  const f = await createSubcategory(t.database, t.ada.id, adas, food.id, { name: 'Fun' });
  if (!g.ok || !f.ok) throw new Error('subcategory');
  [groceries, fun] = [g.id, f.id];
  const source = await createIncomeSource(t.database, t.ada.id, adas, { name: 'Salary' });
  if (!source.ok) throw new Error('source');
  pay = source.id;
  await setBudget(t.database, t.ada.id, adas, {
    kind: 'subcategory',
    targetId: groceries,
    amount: 50_000,
    when: 'this',
    currentMonth: MONTH,
  });
  await setBudget(t.database, t.ada.id, adas, {
    kind: 'subcategory',
    targetId: fun,
    amount: 10_000,
    when: 'this',
    currentMonth: MONTH,
  });
  await setBudget(t.database, t.ada.id, adas, {
    kind: 'income',
    targetId: pay,
    amount: 400_000,
    when: 'this',
    currentMonth: MONTH,
  });
  const spend = (sub: string, amount: number, date: string) =>
    createTransaction(t.database, t.ada.id, adas, {
      type: 'expense',
      date,
      lines: [
        { account: bank, amount: -amount, currency: 'USD' },
        { subcategory: sub, amount, currency: 'USD' },
      ],
    });
  await spend(groceries, 45_000, '2026-11-03');
  await spend(fun, 15_000, '2026-11-10');
  await createTransaction(t.database, t.ada.id, adas, {
    type: 'income',
    date: '2026-11-01',
    lines: [
      { account: bank, amount: 420_000, currency: 'USD' },
      { incomeSource: pay, amount: -420_000, currency: 'USD' },
    ],
  });
  await spend(groceries, 99_999, '2026-10-30'); // another month
});
afterAll(async () => t.close());

describe(`Overview (${leg})`, () => {
  it('shows this month’s figures equal to the budget screen’s and the income page’s own, and what is saved is their difference', async () => {
    const page = await loadOverviewPage(t.database, t.ada.id, book, NOW);
    const budget = await loadBudget(t.database, t.ada.id, book, MONTH, NOW);
    const income = await loadIncome(t.database, t.ada.id, book, MONTH, NOW);
    expect(page.month).toBe(MONTH);
    expect(page.thisMonth.spent).toEqual(budget.spent);
    expect(page.thisMonth.received).toEqual(income.received);
    expect(page.thisMonth.spent?.amount).toBe(60_000);
    expect(page.thisMonth.received?.amount).toBe(420_000);
    expect(page.thisMonth.actualSaved).toBe(360_000);
    expect(page.thisMonth.projectedSaved).toBe(400_000 - 60_000);
  });

  it('has the net worth of the accounts and the budget rows closest to or over, most used first, with nothing from another month', async () => {
    const page = await loadOverviewPage(t.database, t.ada.id, book, NOW);
    expect(page.worth.netWorth.total?.amount).toBe(1_000_000 - 60_000 - 99_999 + 420_000);
    expect(
      page.close.map((c) => [c.line.subcategory.name, c.line.spent.amount, c.line.over]),
    ).toEqual([
      ['Fun', 15_000, 5_000],
      ['Groceries', 45_000, 0],
    ]);
  });

  it('lists the latest entries first, at most eight, and the checklist reads what the book has', async () => {
    const page = await loadOverviewPage(t.database, t.ada.id, book, NOW);
    expect(page.recent.length).toBeLessThanOrEqual(8);
    expect(page.recent[0]?.date).toBe('2026-11-10');
    expect(page.hasAccounts).toBe(true);
    expect(page.checklist.filter((i) => i.done).map((i) => i.id)).toEqual([]);
    await createAccount(t.database, t.ada.id, adas, {
      type: 'credit_card',
      name: 'Card',
      currency: 'USD',
    });
    const after = await loadOverviewPage(t.database, t.ada.id, book, NOW);
    expect(after.checklist.filter((i) => i.done).map((i) => i.id)).toEqual(['accounts', 'debts']);
  });

  it('shows nothing of another person’s, and a new book has the checklist and no figures to speak of', async () => {
    await ensureBook(t.database, t.grace.id);
    const hers = (await findBook(t.database, t.grace.id)) as Book;
    const page = await loadOverviewPage(t.database, t.grace.id, hers, NOW);
    expect(page).toMatchObject({ hasAccounts: false, close: [], recent: [] });
    expect(page.checklist.some((i) => !i.done && i.href !== null)).toBe(true);
    expect(page.thisMonth.base).toBeNull();
  });
});
