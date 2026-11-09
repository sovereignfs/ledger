import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { FX_PIVOT_CODE, isSupportedCurrencyCode } from '../money/currencies';
import { RateTable, type RateRow } from '../money/convert';
import { fetchLatestRates, isCalendarDay, type FetchOptions } from './frankfurter';

/**
 * The rate table and what is read from it (DESIGN.md §9.2). `fx_rate` is the instance's and no person's: it has no `book_id`, so none of these statements carries
 * the membership condition, and it is nothing `People.deletePerson` touches. What a rate is *used* for, a person's amount at a date, is in `src/money`.
 */
const table = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema.fxRate : sqliteSchema.fxRate;
const bookCurrencies = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema.bookCurrency : sqliteSchema.bookCurrency;

/** What is recorded as the source of a row. */
export const FX_SOURCE = 'frankfurter';

/**
 * The currencies some book uses and a rate is wanted for: every distinct code in `book_currency`, without the pivot, whose rate is one by definition. (A
 * money account's currency is in `book_currency` too, since a book has the currencies its accounts name, DESIGN.md §9.1.) This reads across books and is
 * the one place that does, for the instance's job: nothing of a person comes out of it but the codes.
 */
export async function currenciesInUse(database: Database): Promise<string[]> {
  const rows = await dbAll<{ code: string }>(
    database,
    sql`SELECT DISTINCT code AS code FROM ${bookCurrencies(database)} WHERE code <> ${FX_PIVOT_CODE} ORDER BY code`,
  );
  return rows.map((row) => row.code).filter(isSupportedCurrencyCode);
}

/**
 * Stores one day's rates, one row per currency and day, keeping the row that is there: a second fetch on one day, from this process or another, changes
 * nothing. Returns how many rows were new. A rate that is not exact text is refused here too, whoever calls.
 */
export async function storeRates(
  database: Database,
  asOf: string,
  rates: ReadonlyMap<string, string>,
  now: number,
): Promise<number> {
  if (!isCalendarDay(asOf)) throw new RangeError('storeRates: not a day');
  let added = 0;
  await transaction(database, async (tx) => {
    for (const [currency, rate] of rates) {
      if (!isSupportedCurrencyCode(currency) || currency === FX_PIVOT_CODE)
        throw new RangeError('storeRates: not a currency with a rate');
      if (!/^\d+(?:\.\d+)?$/.test(rate) || !/[1-9]/.test(rate))
        throw new RangeError('storeRates: not a rate');
      const inserted = await dbAll<{ currency: string }>(
        tx,
        sql`INSERT INTO ${table(tx)} (currency, as_of, rate, source, fetched_at)
            VALUES (${currency}, ${asOf}, ${rate}, ${FX_SOURCE}, ${now})
            ON CONFLICT (currency, as_of) DO NOTHING
            RETURNING currency`,
      );
      added += inserted.length;
    }
  });
  return added;
}

export interface FetchRatesOptions extends Pick<FetchOptions, 'url' | 'signal' | 'fetch'> {
  readonly now: Date;
}

export interface FetchRatesResult {
  /** The currencies a rate was wanted for. */
  readonly wanted: number;
  /** Rows made; fewer than `wanted` when the source does not list a currency, or when the day's rows were there already. */
  readonly stored: number;
  /** Whether a request was made: never for an instance that uses no currency but USD. */
  readonly requested: boolean;
}

/**
 * One fetch (DESIGN.md §9.2): the currencies in use, **no request at all if there are none**, one request if there are, and a row per currency and day for those
 * the answer lists. A currency the answer does not list is left without a rate and fails nothing. Run twice, it stores each row once. The transaction is
 * after the request and not around it, since nothing is held across a call to another service.
 */
export async function fetchRates(
  database: Database,
  options: FetchRatesOptions,
): Promise<FetchRatesResult> {
  const wanted = await currenciesInUse(database);
  if (wanted.length === 0) return { wanted: 0, stored: 0, requested: false };
  const latest = await fetchLatestRates(options);
  const rows = new Map<string, string>();
  for (const code of wanted) {
    const rate = latest.rates.get(code);
    if (rate !== undefined) rows.set(code, rate);
  }
  const stored = await storeRates(database, latest.asOf, rows, options.now.getTime());
  return { wanted: wanted.length, stored, requested: true };
}

/** A rate in force on a day: how many units of the currency one US dollar buys, as a decimal string, and the day it is the rate of. */
export interface RateOn {
  readonly rate: string;
  readonly asOf: string;
}

/**
 * The rate of `currency` against US dollars **in force on `date`**: the latest row not after it (DESIGN.md §9.2), which on a weekend is Friday's. **No row, no
 * rate:** a date before the first rate has `undefined`, and so does a currency that has never been fetched or that the source does not list; nothing is
 * guessed from a later day. USD is the pivot and is one on every day. A date that is not a calendar day, or a code that is not a currency, is a mistake of the
 * caller and throws.
 */
export async function rateOn(
  database: Database,
  currency: string,
  date: string,
): Promise<RateOn | undefined> {
  if (!isSupportedCurrencyCode(currency)) throw new RangeError('rateOn: not a currency');
  if (!isCalendarDay(date)) throw new RangeError('rateOn: not a day');
  if (currency === FX_PIVOT_CODE) return { rate: '1', asOf: date };
  const rows = await dbAll<{ rate: string; asOf: string }>(
    database,
    sql`SELECT rate AS rate, as_of AS "asOf" FROM ${table(database)}
         WHERE currency = ${currency} AND as_of <= ${date}
         ORDER BY as_of DESC LIMIT 1`,
  );
  return rows[0];
}

/**
 * The rates a page needs, **loaded once** for the currencies and the dates (`from` to `to`, both days): every row in the range, and for each currency the
 * latest row before it, so that the rate in force on any date of the range is in the table (DESIGN.md §9.3). One statement, whatever the number of amounts the
 * page converts. USD needs no row. A currency with no row at all is simply absent, and an amount in it comes out as not included.
 */
export async function loadRates(
  database: Database,
  currencies: readonly string[],
  from: string,
  to: string,
): Promise<RateTable> {
  if (!isCalendarDay(from) || !isCalendarDay(to) || from > to)
    throw new RangeError('loadRates: not a range of days');
  const wanted = [...new Set(currencies)].filter((code) => code !== FX_PIVOT_CODE);
  if (!wanted.every(isSupportedCurrencyCode))
    throw new RangeError('loadRates: not a list of currencies');
  if (wanted.length === 0) return new RateTable(from, to, []);
  const rows = await dbAll<RateRow>(
    database,
    sql`SELECT f.currency AS currency, f.as_of AS "asOf", f.rate AS rate FROM ${table(database)} f
         WHERE f.currency IN (${sql.join(
           wanted.map((code) => sql`${code}`),
           sql`, `,
         )})
           AND f.as_of <= ${to}
           AND f.as_of >= COALESCE(
                 (SELECT MAX(p.as_of) FROM ${table(database)} p WHERE p.currency = f.currency AND p.as_of <= ${from}),
                 '')
         ORDER BY f.currency, f.as_of`,
  );
  return new RateTable(from, to, rows);
}
