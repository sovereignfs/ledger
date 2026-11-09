import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { addMonths, monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { loadRates } from '../fx/rates';
import type { Book } from '../ledger/books';
import { lastDayOf } from '../budget/income';
import { sumMinor } from '../money/amount';
import { type ConvertedTotal, type Dated, type RateSource, convertedTotal } from '../money/convert';

/**
 * Net worth over time (DESIGN.md §11.3): **the sum of every money account's balance at a date, converted at that date's rates**, assets and liabilities apart. **Nothing is
 * stored**: the history is the month ends, computed from the lines, an opening, a new value and an adjustment included. The series is computed **in one pass**: the lines
 * are read once, summed for each account and day, and the balances run forward through the dates, so twenty-four months cost one read of the lines and not twenty-four.
 * A balance above nothing is an asset (money you have, or a person who owes you) and one below nothing a liability (what you owe, or a person you owe), so assets and
 * liabilities add up to the net worth the Accounts screen shows, converted account by account. An amount with no rate is **left out and said**, never counted as nothing.
 * The series is **pure** over the lines and the rates.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

/** What an account's lines came to on one day, in its own currency. */
export interface Movement {
  readonly accountId: string;
  readonly currency: string;
  readonly date: string;
  readonly amount: number;
}

export interface NetWorthPoint {
  /** The day: a month's last, or today for the current month. */
  readonly date: string;
  readonly month: string;
  /** What is above nothing, in the base currency, with what was left out for want of a rate. */
  readonly assets: ConvertedTotal;
  /** What is below nothing, in the base currency, **negative**, with what was left out. */
  readonly liabilities: ConvertedTotal;
  /** Assets and liabilities together: the net worth. */
  readonly total: number;
}

/**
 * The net worth on each of the `dates` (ascending), from the movements of every account up to the last of them. **A single pass:** the movements are sorted by day
 * once, and each date takes the balances as they stand when the pass reaches it.
 */
export function netWorthSeries(input: {
  movements: readonly Movement[];
  dates: readonly string[];
  base: string;
  rates: RateSource;
}): NetWorthPoint[] {
  const sorted = [...input.movements].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const balances = new Map<string, { currency: string; amount: number }>();
  const points: NetWorthPoint[] = [];
  let at = 0;
  for (const date of input.dates) {
    for (; at < sorted.length && (sorted[at] as Movement).date <= date; at++) {
      const move = sorted[at] as Movement;
      const have = balances.get(move.accountId) ?? { currency: move.currency, amount: 0 };
      balances.set(move.accountId, { currency: have.currency, amount: have.amount + move.amount });
    }
    const items = (keep: (amount: number) => boolean): Dated[] =>
      [...balances.values()]
        .filter((balance) => balance.amount !== 0 && keep(balance.amount))
        .map((balance) => ({ amount: balance.amount, currency: balance.currency, date }));
    const assets = convertedTotal(
      items((amount) => amount > 0),
      input.base,
      input.rates,
    );
    const liabilities = convertedTotal(
      items((amount) => amount < 0),
      input.base,
      input.rates,
    );
    points.push({
      date,
      month: monthOf(date),
      assets,
      liabilities,
      total: sumMinor([assets.amount, liabilities.amount]),
    });
  }
  return points;
}

/** The month ends of the `months` months up to and including the current one, ascending; the current month's is today. */
export function monthEnds(today: string, months: number): string[] {
  const current = monthOf(today);
  return Array.from({ length: months }, (_, at) => {
    const month = addMonths(current, at - (months - 1));
    return month === current ? today : lastDayOf(month);
  });
}

/** Each account's lines summed for each day, up to a day: **one read of the lines of the book**. */
async function movementsUpTo(
  database: Database,
  accountId: string,
  bookId: string,
  to: string,
): Promise<Movement[]> {
  const s = schema(database);
  const rows = await dbAll<{
    accountId: string;
    currency: string;
    date: string;
    amount: number | string;
  }>(
    database,
    sql`SELECT l.account_id AS "accountId", a.currency AS currency, t.date AS date, SUM(l.amount) AS amount
          FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
          JOIN ${s.moneyAccount} a ON a.id = l.account_id AND a.book_id = l.book_id
         WHERE l.book_id = ${bookId} AND ${inBook(database, sql`l.book_id`, accountId)}
           AND l.account_id IS NOT NULL AND t.date <= ${to}
         GROUP BY l.account_id, a.currency, t.date`,
  );
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

/**
 * The net worth at each month end of the last `months` months (the current month's point is today), assets and liabilities apart. The lines are read **once**, and the
 * rates once for the range; `null` while the book has no base currency, which has nothing to convert to.
 */
export async function loadNetWorthSeries(
  database: Database,
  accountId: string,
  book: Book,
  months = 24,
  now: Date = new Date(),
): Promise<NetWorthPoint[] | null> {
  if (book.baseCurrency === null) return null;
  const today = todayIn(book.timeZone, now);
  const dates = monthEnds(today, months);
  const movements = await movementsUpTo(database, accountId, book.id, today);
  const currencies = [...new Set([book.baseCurrency, ...movements.map((move) => move.currency)])];
  const rates = await loadRates(database, currencies, dates[0] as string, today);
  return netWorthSeries({ movements, dates, base: book.baseCurrency, rates });
}

/** The net worth on one day, which is the series of that day alone; `null` while the book has no base currency. */
export async function netWorthAt(
  database: Database,
  accountId: string,
  book: Book,
  date: string,
): Promise<NetWorthPoint | null> {
  if (book.baseCurrency === null) return null;
  const movements = await movementsUpTo(database, accountId, book.id, date);
  const currencies = [...new Set([book.baseCurrency, ...movements.map((move) => move.currency)])];
  const rates = await loadRates(database, currencies, date, date);
  return netWorthSeries({ movements, dates: [date], base: book.baseCurrency, rates })[0] ?? null;
}
