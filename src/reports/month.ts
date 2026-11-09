import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { addMonths, isMonth, monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { loadRates } from '../fx/rates';
import { listAccounts, type AccountRow } from '../ledger/accounts';
import { balancesOf } from '../ledger/balances';
import type { Book } from '../ledger/books';
import { sumMinor } from '../money/amount';
import {
  type ConvertedTotal,
  type Dated,
  type RateSource,
  convertedTotal,
  notIncludedLines,
} from '../money/convert';
import { type IncomeFigures, lastDayOf, loadIncome, receivedBetween } from '../budget/income';
import {
  type BudgetFigures,
  type BudgetLine,
  type Spent,
  loadBudget,
  spentBetween,
} from '../budget/screen';

/**
 * A month's figures, **one computation everywhere** (DESIGN.md §11.1, §11.2): the screens, the recap and the insights read this and add no arithmetic of their own.
 * **Income** is budgeted and received; **spent** is the subcategory lines of the month's entries (a loan's interest is spent, being a line on a subcategory, and
 * its principal is not, being a line on the loan: a transfer of debt); **the three savings figures** are *projected* (budgeted income less budgeted spending),
 * *actual* (income received less spent) and *actual after jars* (actual less what was earmarked in the jars that month, which are not spending); and the small
 * summaries are the cards, the people and the loans. Amounts are in the base currency with what could not be converted **said and never counted as nothing**.
 * The builder is **pure** over rows and rates, so a test needs no database.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export interface CategoryReport {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  /** In the category's currency: the sum of its subcategories' budgeted amounts (a subcategory with none counts nothing), and of what was spent in them. */
  readonly budgeted: number;
  readonly spent: number;
  readonly over: number;
  readonly rows: readonly BudgetLine[];
}

export interface Savings {
  /** Budgeted income less budgeted spending; `null` while there is no base currency or a figure is missing. */
  readonly projected: number | null;
  /** Income received less spent. */
  readonly actual: number | null;
  /** Actual less the jar contributions earmarked in the month. */
  readonly afterJars: number | null;
}

export interface CardSummary {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  /** What is owed on the card at the month's end, not below nothing. */
  readonly used: number;
  readonly limit: number | null;
}

export interface LoanSummary {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  /** What is left to pay at the month's end. */
  readonly left: number;
  /** What came off the loan in the month: the principal paid, not the interest. */
  readonly paid: number;
}

export interface MonthReport {
  readonly month: string;
  readonly base: string | null;
  readonly income: IncomeFigures;
  readonly budget: BudgetFigures;
  readonly categories: readonly CategoryReport[];
  readonly savings: Savings;
  /** What was earmarked in the jars in the month, in the base currency; `null` while the book has no base currency. */
  readonly jars: ConvertedTotal | null;
  readonly cards: readonly CardSummary[];
  /** What people owe you and what you owe them at the month's end, in the base currency. */
  readonly people: { readonly owedToYou: ConvertedTotal; readonly youOwe: ConvertedTotal } | null;
  readonly loans: readonly LoanSummary[];
  /** What any figure left out for want of a rate, in words. */
  readonly notIncluded: readonly string[];
}

/** The categories of a budget's rows, each rolled up in its own currency, in the order of the rows. */
export function categoriesOf(budget: BudgetFigures): CategoryReport[] {
  const by = new Map<string, { head: BudgetLine['category']; rows: BudgetLine[] }>();
  for (const row of budget.groups.flatMap((group) => group.rows)) {
    const entry = by.get(row.category.id) ?? { head: row.category, rows: [] };
    entry.rows.push(row);
    by.set(row.category.id, entry);
  }
  return [...by.values()].map(({ head, rows }) => {
    const budgeted = sumMinor(rows.map((row) => row.budgeted ?? 0));
    const spent = sumMinor(rows.map((row) => row.spent.amount));
    return {
      id: head.id,
      name: head.name,
      currency: head.currency,
      budgeted,
      spent,
      over: spent > budgeted && budgeted > 0 ? spent - budgeted : 0,
      rows,
    };
  });
}

/** A month's report from its parts, **pure**. `accounts` carry their balances at the month's end; `loanPaid` is the principal that came off each loan in the month. */
export function buildMonthReport(input: {
  month: string;
  base: string | null;
  income: IncomeFigures;
  budget: BudgetFigures;
  /** Earmarked in the jars in the month, one amount for each currency and day. */
  jarContributions: readonly Dated[];
  accounts: readonly Pick<
    AccountRow,
    'id' | 'type' | 'name' | 'currency' | 'creditLimit' | 'balance'
  >[];
  loanPaid: ReadonlyMap<string, number>;
  rates: RateSource;
  asOf: string;
}): MonthReport {
  const { month, base, income, budget, accounts, loanPaid, rates, asOf } = input;
  const jars = base === null ? null : convertedTotal(input.jarContributions, base, rates);
  const projected =
    income.budgeted && budget.budgeted ? income.budgeted.amount - budget.budgeted.amount : null;
  const actual =
    income.received && budget.spent ? income.received.amount - budget.spent.amount : null;
  const afterJars = actual !== null && jars ? actual - jars.amount : null;

  const cards: CardSummary[] = accounts
    .filter((account) => account.type === 'credit_card')
    .map((card) => ({
      id: card.id,
      name: card.name,
      currency: card.currency,
      used: Math.max(0, -card.balance),
      limit: card.creditLimit,
    }));
  const loans: LoanSummary[] = accounts
    .filter((account) => account.type === 'loan')
    .map((loan) => ({
      id: loan.id,
      name: loan.name,
      currency: loan.currency,
      left: Math.max(0, -loan.balance),
      paid: loanPaid.get(loan.id) ?? 0,
    }));
  const owed = (sign: 1 | -1): Dated[] =>
    accounts.flatMap((account) =>
      account.type === 'person' && sign * account.balance > 0
        ? [{ amount: sign * account.balance, currency: account.currency, date: asOf }]
        : [],
    );
  const people =
    base === null
      ? null
      : {
          owedToYou: convertedTotal(owed(1), base, rates),
          youOwe: convertedTotal(owed(-1), base, rates),
        };

  const left = (label: string, total: ConvertedTotal | null) =>
    total ? notIncludedLines(total).map((line) => `${label}: ${line}`) : [];
  return {
    month,
    base,
    income,
    budget,
    categories: categoriesOf(budget),
    savings: { projected, actual, afterJars },
    jars,
    cards,
    people,
    loans,
    notIncluded: [
      ...left('Income', income.received),
      ...left('Spent', budget.spent),
      ...left('Budgeted income', income.budgeted),
      ...left('Budgeted spending', budget.budgeted),
      ...left('Jars', jars),
      ...left('Owed to you', people?.owedToYou ?? null),
      ...left('You owe', people?.youOwe ?? null),
    ],
  };
}

/** What was earmarked in the jars from one day to another, one amount for each currency and day: contributions that were made, a skipped one being nothing. */
async function jarContributionsBetween(
  database: Database,
  accountId: string,
  bookId: string,
  from: string,
  to: string,
): Promise<Dated[]> {
  const s = schema(database);
  const rows = await dbAll<{ currency: string; date: string; amount: number | string }>(
    database,
    sql`SELECT a.currency AS currency, v.date AS date, SUM(v.amount) AS amount
          FROM ${s.jarMovement} v JOIN ${s.jar} j ON j.id = v.jar_id AND j.book_id = v.book_id
          JOIN ${s.moneyAccount} a ON a.id = j.account_id AND a.book_id = j.book_id
         WHERE v.book_id = ${bookId} AND ${inBook(database, sql`v.book_id`, accountId)}
           AND v.kind = 'contribution' AND v.amount > 0 AND v.date >= ${from} AND v.date <= ${to}
         GROUP BY a.currency, v.date ORDER BY v.date`,
  );
  return rows.map((row) => ({
    amount: Number(row.amount),
    currency: row.currency,
    date: row.date,
  }));
}

/** What came off each loan from one day to another: the positive lines on the loan account, the principal paid. */
async function loanPaidBetween(
  database: Database,
  accountId: string,
  bookId: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const s = schema(database);
  const rows = await dbAll<{ id: string; total: number | string }>(
    database,
    sql`SELECT l.account_id AS id, SUM(l.amount) AS total
          FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
          JOIN ${s.moneyAccount} a ON a.id = l.account_id AND a.book_id = l.book_id
         WHERE l.book_id = ${bookId} AND ${inBook(database, sql`l.book_id`, accountId)}
           AND a.type = 'loan' AND l.amount > 0 AND t.type <> 'opening' AND t.date >= ${from} AND t.date <= ${to}
         GROUP BY l.account_id`,
  );
  return new Map(rows.map((row) => [row.id, Number(row.total)]));
}

/** Loads a month's report: the same figures the budget screen and the income page read, and the jars, cards, people and loans at the month's end. Reads only the account's own book. */
export async function loadMonthReport(
  database: Database,
  accountId: string,
  book: Book,
  month: string,
  now: Date = new Date(),
): Promise<MonthReport> {
  if (!isMonth(month)) throw new RangeError('loadMonthReport: not a month');
  const today = todayIn(book.timeZone, now);
  const end = lastDayOf(month);
  const asOf = today >= `${month}-01` && today < end ? today : end;
  const [income, budget, accounts, balances, jarContributions, loanPaid] = await Promise.all([
    loadIncome(database, accountId, book, month, now),
    loadBudget(database, accountId, book, month, now),
    listAccounts(database, accountId, book.id),
    balancesOf(database, accountId, book.id, asOf),
    jarContributionsBetween(database, accountId, book.id, `${month}-01`, end),
    loanPaidBetween(database, accountId, book.id, `${month}-01`, end),
  ]);
  const currencies = [
    ...new Set([
      ...accounts.map((account) => account.currency),
      ...jarContributions.map((each) => each.currency),
      ...(book.baseCurrency ? [book.baseCurrency] : []),
    ]),
  ];
  const rates = await loadRates(database, currencies, `${month}-01`, end);
  return buildMonthReport({
    month,
    base: book.baseCurrency,
    income,
    budget,
    jarContributions,
    accounts: accounts.map((account) => ({ ...account, balance: balances.get(account.id) ?? 0 })),
    loanPaid,
    rates,
    asOf,
  });
}

/** One line of the list of months. */
export interface MonthLine {
  readonly month: string;
  /** In the base currency, with what was left out; `null` while there is no base currency. */
  readonly received: ConvertedTotal | null;
  readonly spent: ConvertedTotal | null;
  /** Received less spent, or `null` when either is missing. */
  readonly saved: number | null;
  /** The current month, which is not over. */
  readonly inProgress: boolean;
}

/**
 * The months of the book, newest first: from the month of its first entry to the current one, each with income received and spent. **Two reads for the whole
 * range**, not two for each month; each amount is converted at the rate of its own day, as in the month's own report.
 */
export async function loadMonthList(
  database: Database,
  accountId: string,
  book: Book,
  now: Date = new Date(),
  limit = 36,
): Promise<MonthLine[]> {
  const s = schema(database);
  const today = todayIn(book.timeZone, now);
  const current = monthOf(today);
  const first = await dbAll<{ date: string | null }>(
    database,
    sql`SELECT MIN(t.date) AS date FROM ${s.txn} t WHERE t.book_id = ${book.id} AND ${inBook(database, sql`t.book_id`, accountId)}`,
  );
  const firstDate = first[0]?.date;
  if (!firstDate) return [];
  const months: string[] = [];
  for (let month = current; month >= monthOf(firstDate) && months.length < limit;) {
    months.push(month);
    month = addMonths(month, -1);
  }
  const from = `${months[months.length - 1]}-01`;
  const to = lastDayOf(current);
  const [spent, received] = await Promise.all([
    spentBetween(database, accountId, book.id, from, to),
    receivedBetween(database, accountId, book.id, from, to),
  ]);
  const base = book.baseCurrency;
  const rates = await loadRates(
    database,
    [
      ...new Set([
        ...spent.map((x) => x.currency),
        ...received.map((x) => x.currency),
        ...(base ? [base] : []),
      ]),
    ],
    from,
    to,
  );
  const items = (
    list: readonly { currency: string; date: string; amount: number }[],
    month: string,
  ): Dated[] =>
    list
      .filter((each) => each.date.startsWith(month))
      .map(({ amount, currency, date }) => ({ amount, currency, date }));
  return months.map((month) => {
    const got = base ? convertedTotal(items(received, month), base, rates) : null;
    const out = base ? convertedTotal(items(spent as readonly Spent[], month), base, rates) : null;
    return {
      month,
      received: got,
      spent: out,
      saved: got && out ? got.amount - out.amount : null,
      inProgress: month === current,
    };
  });
}
