import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { addMonths, monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { lastDayOf } from '../budget/income';
import { loadBudget } from '../budget/screen';
import type { Book } from '../ledger/books';
import {
  type CompletedMonth,
  type ExpenseLine,
  type Insight,
  LARGE_MONTHS,
  OVER_BUDGET_MONTHS,
  allInsights,
} from './rules';

/**
 * The insights a page needs (DESIGN.md §12), worked out from the book's own rows when asked and never stored: the last two completed months' budgets and what was spent
 * (the Budget screen's own figures), and the expenses of the six months before the ones looked at. `month` is a month's report, whose insights are those as of its end
 * (the months through it when it is over, the ones before it when it is not) and whose large expenses are those in it; without one, it is Overview: the last completed
 * months and the expenses of the last thirty days. `limit` keeps the first few.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const daysBack = (day: string, days: number): string =>
  new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)) - days),
  )
    .toISOString()
    .slice(0, 10);

export async function loadInsights(
  database: Database,
  accountId: string,
  book: Book,
  now: Date = new Date(),
  options: { month?: string; limit?: number } = {},
): Promise<Insight[]> {
  const today = todayIn(book.timeZone, now);
  const current = monthOf(today);
  const through =
    options.month !== undefined && options.month < current
      ? options.month
      : addMonths(options.month ?? current, -1);
  const window =
    options.month !== undefined
      ? { from: `${options.month}-01`, to: lastDayOf(options.month) }
      : { from: daysBack(today, 30), to: today };
  const months: CompletedMonth[] = [];
  for (let at = 0; at < OVER_BUDGET_MONTHS; at++) {
    const month = addMonths(through, -at);
    const figures = await loadBudget(database, accountId, book, month, now);
    months.push({
      month,
      rows: figures.groups
        .flatMap((group) => group.rows)
        .map((line) => ({
          subcategoryId: line.subcategory.id,
          name: line.subcategory.name,
          currency: line.category.currency,
          budgeted: line.budgeted,
          spent: line.spent.amount,
        })),
    });
  }
  const s = schema(database);
  const from = `${addMonths(window.from.slice(0, 7), -LARGE_MONTHS)}-01`;
  const rows = await dbAll<{
    txnId: string;
    date: string;
    subcategoryId: string;
    name: string;
    currency: string;
    amount: number | string;
  }>(
    database,
    sql`SELECT l.txn_id AS "txnId", t.date AS date, l.subcategory_id AS "subcategoryId", u.name AS name, l.currency AS currency, SUM(l.amount) AS amount
          FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
          JOIN ${s.subcategory} u ON u.id = l.subcategory_id AND u.book_id = l.book_id
         WHERE l.book_id = ${book.id} AND ${inBook(database, sql`l.book_id`, accountId)}
           AND t.type = 'expense' AND l.subcategory_id IS NOT NULL AND t.date >= ${from} AND t.date <= ${window.to}
         GROUP BY l.txn_id, t.date, l.subcategory_id, u.name, l.currency
         ORDER BY t.date, l.txn_id`,
  );
  const expenses: ExpenseLine[] = rows.map((row) => ({ ...row, amount: Number(row.amount) }));
  return allInsights(
    { months, expenses, window, ...(book.locale ? { locale: book.locale } : {}) },
    options.limit,
  );
}
