import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { addMonths, isMonth, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { loadRates } from '../fx/rates';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import type { Book } from '../ledger/books';
import { sumMinor } from '../money/amount';
import { type ConvertedTotal, type Dated, type RateSource, convertedTotal } from '../money/convert';
import { budgetsForMonth } from './amounts';
import { type IncomeSourceRow, listIncomeSources } from './income-sources';

/**
 * Income planned and income that arrived (DESIGN.md §7.4): for a month, each source's **budgeted** amount (in force that month, `amounts.ts`) and **received**
 * amount (the income-source lines of the entries dated in it), **kept apart** and each converted to the base currency, **each received amount at the rate of its
 * own day**. An amount with no rate is reported as not included and never counted as nothing (§9.3). The figures are pure over rows and rates, so the screen,
 * the reports and the tests have one implementation.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

/** Income that arrived: one amount of a source on a day, in the currency it was received in, positive. */
export interface Received {
  readonly sourceId: string;
  readonly currency: string;
  readonly date: string;
  readonly amount: number;
}

export interface IncomeRow {
  readonly source: IncomeSourceRow;
  /** The budgeted amount in force that month, in the source's currency; `null` when no budget is in force yet. */
  readonly budgeted: number | null;
  /** What was received from it, by the currency it was received in. */
  readonly received: readonly { currency: string; amount: number }[];
}

export interface IncomeFigures {
  readonly month: string;
  readonly rows: readonly IncomeRow[];
  /** The base currency, or `null` while the book has none. */
  readonly base: string | null;
  /** Budgeted and received in the base currency, each with what it left out for want of a rate; `null` while the book has no base currency. */
  readonly budgeted: ConvertedTotal | null;
  readonly received: ConvertedTotal | null;
  /** Each currency's own totals, for a book with no base currency (and for no other). */
  readonly byCurrency: {
    budgeted: readonly { currency: string; amount: number }[];
    received: readonly { currency: string; amount: number }[];
  };
}

function sumsByCurrency(
  items: readonly { currency: string; amount: number }[],
): { currency: string; amount: number }[] {
  const by = new Map<string, number[]>();
  for (const item of items) by.set(item.currency, [...(by.get(item.currency) ?? []), item.amount]);
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, amounts]) => ({ currency, amount: sumMinor(amounts) }));
}

/**
 * The month's figures. `budgets` is `budgetsForMonth` (keyed `income:<id>`); a budgeted amount is converted at `budgetDate` (the month's end, or today when the
 * month is not over) and a received amount at the day it was received. Archived sources are in the rows when they have anything to show.
 */
export function incomeFigures(input: {
  month: string;
  sources: readonly IncomeSourceRow[];
  budgets: ReadonlyMap<string, number>;
  received: readonly Received[];
  base: string | null;
  rates: RateSource;
  budgetDate: string;
}): IncomeFigures {
  const { month, sources, budgets, received, base, rates, budgetDate } = input;
  const rows: IncomeRow[] = sources
    .map((source) => ({
      source,
      budgeted: budgets.get(`income:${source.id}`) ?? null,
      received: sumsByCurrency(received.filter((each) => each.sourceId === source.id)),
    }))
    .filter(
      (row) => row.source.archivedAt === null || row.received.length > 0 || (row.budgeted ?? 0) > 0,
    );
  const budgetedItems: Dated[] = rows.flatMap((row) =>
    row.budgeted === null || row.budgeted === 0
      ? []
      : [{ amount: row.budgeted, currency: row.source.currency, date: budgetDate }],
  );
  const receivedItems: Dated[] = received.map((each) => ({
    amount: each.amount,
    currency: each.currency,
    date: each.date,
  }));
  return {
    month,
    rows,
    base,
    budgeted: base === null ? null : convertedTotal(budgetedItems, base, rates),
    received: base === null ? null : convertedTotal(receivedItems, base, rates),
    byCurrency:
      base === null
        ? { budgeted: sumsByCurrency(budgetedItems), received: sumsByCurrency(receivedItems) }
        : { budgeted: [], received: [] },
  };
}

/** The last day of a month, `YYYY-MM-DD`. */
export function lastDayOf(month: string): string {
  const next = addMonths(month, 1);
  const end = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 0));
  return end.toISOString().slice(0, 10);
}

/** What was received in a month: the income-source lines of the account's entries dated in it, one amount for each source, currency and day. */
export async function receivedInMonth(
  database: Database,
  accountId: string,
  bookId: string,
  month: string,
): Promise<Received[]> {
  if (!isMonth(month)) throw new RangeError('receivedInMonth: not a month');
  return receivedBetween(database, accountId, bookId, `${month}-01`, lastDayOf(month));
}

/** What was received from one day to another, both included: the same rows as a month's, over any range. */
export async function receivedBetween(
  database: Database,
  accountId: string,
  bookId: string,
  from: string,
  to: string,
): Promise<Received[]> {
  const s = schema(database);
  const rows = await dbAll<{
    sourceId: string;
    currency: string;
    date: string;
    amount: number | string;
  }>(
    database,
    sql`SELECT l.income_source_id AS "sourceId", l.currency AS currency, t.date AS date, -SUM(l.amount) AS amount
          FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
         WHERE l.book_id = ${bookId} AND ${inBook(database, sql`l.book_id`, accountId)}
           AND l.income_source_id IS NOT NULL AND t.date >= ${from} AND t.date <= ${to}
         GROUP BY l.income_source_id, l.currency, t.date
         ORDER BY t.date, l.income_source_id`,
  );
  return rows.map((row) => ({
    sourceId: row.sourceId,
    currency: row.currency,
    date: row.date,
    amount: Number(row.amount),
  }));
}

/** Loads a month's figures: the sources, the budgets in force, what was received, and the rates for the days they fall on. Reads only the account's own book. */
export async function loadIncome(
  database: Database,
  accountId: string,
  book: Book,
  month: string,
  now: Date = new Date(),
): Promise<IncomeFigures> {
  const [sources, budgets, received] = await Promise.all([
    listIncomeSources(database, accountId, book.id),
    budgetsForMonth(database, accountId, book.id, month),
    receivedInMonth(database, accountId, book.id, month),
  ]);
  const today = todayIn(book.timeZone, now);
  const end = lastDayOf(month);
  const budgetDate = today >= `${month}-01` && today < end ? today : end;
  const currencies = [
    ...new Set([
      ...sources.map((s) => s.currency),
      ...received.map((r) => r.currency),
      ...(book.baseCurrency ? [book.baseCurrency] : []),
    ]),
  ];
  const rates = await loadRates(database, currencies, `${month}-01`, end);
  return incomeFigures({
    month,
    sources,
    budgets,
    received,
    base: book.baseCurrency,
    rates,
    budgetDate,
  });
}
