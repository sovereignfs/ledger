import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { isSupportedCurrencyCode } from '../money/currencies';
import { isTimeZone } from '../setup/locale';
import type { WriteResult } from './transactions';

/**
 * What setup chose, changeable (DESIGN.md §15.1, §15.2): the book's name, **base currency**, **time zone**, first day of the week, the locale numbers are written in, and whether
 * the monthly recap is sent. **Nothing stored is changed by any of them**: a base currency is only what totals are converted to when they are read, so changing it re-reports
 * every figure in the new one (§9.1), and the time zone decides what "today" and a month are when posting and the recap look at the clock, so changing it moves when they
 * happen. Every statement carries the permission (`inBook`); a book that is not the account's reads as one that is not there.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export const MAX_BOOK_NAME = 80;

export interface BookPatch {
  readonly name?: string;
  readonly baseCurrency?: string;
  readonly timeZone?: string;
  /** 0 is Sunday, 1 is Monday. */
  readonly firstDayOfWeek?: number;
  /** A BCP 47 tag, or `null` for the browser's own. */
  readonly locale?: string | null;
  readonly recap?: boolean;
}

/** Whether a string is a locale tag the platform knows how to write numbers in. */
export function isLocaleTag(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 35) return false;
  try {
    return (
      Intl.getCanonicalLocales(value).length === 1 &&
      Intl.NumberFormat.supportedLocalesOf(value).length > 0
    );
  } catch {
    return false;
  }
}

/** What is wrong with a change, in sentences; nothing when it can be made. **Pure.** */
export function checkBookPatch(patch: BookPatch): string[] {
  const problems: string[] = [];
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (name === '') problems.push('The book needs a name.');
    else if (name.length > MAX_BOOK_NAME)
      problems.push(`A name is at most ${MAX_BOOK_NAME} characters.`);
  }
  if (patch.baseCurrency !== undefined && !isSupportedCurrencyCode(patch.baseCurrency))
    problems.push('Choose a currency.');
  if (patch.timeZone !== undefined && !isTimeZone(patch.timeZone))
    problems.push('The time zone is not one.');
  if (
    patch.firstDayOfWeek !== undefined &&
    !(
      Number.isInteger(patch.firstDayOfWeek) &&
      patch.firstDayOfWeek >= 0 &&
      patch.firstDayOfWeek <= 6
    )
  )
    problems.push('The first day of the week is a day from Sunday to Saturday.');
  if (patch.locale !== undefined && patch.locale !== null && !isLocaleTag(patch.locale))
    problems.push('That is not a language and region numbers can be written in.');
  if (patch.recap !== undefined && typeof patch.recap !== 'boolean')
    problems.push('The recap is on or off.');
  return problems;
}

/**
 * Changes the book's settings: only what is given. A new base currency joins the book's currencies, which are the ones the rates are fetched for, and nothing already
 * stored is touched. `not_found` for a book that is not the account's; a mistake is a sentence and writes nothing.
 */
export async function updateBook(
  database: Database,
  accountId: string,
  bookId: string,
  patch: BookPatch,
  now: number = Date.now(),
): Promise<WriteResult> {
  const problems = checkBookPatch(patch);
  if (problems.length > 0) return { ok: false, reason: 'invalid', problems };
  const s = schema(database);
  const sets = [sql`updated_at = ${now}`];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name.trim()}`);
  if (patch.baseCurrency !== undefined) sets.push(sql`base_currency = ${patch.baseCurrency}`);
  if (patch.timeZone !== undefined) sets.push(sql`time_zone = ${patch.timeZone}`);
  if (patch.firstDayOfWeek !== undefined)
    sets.push(sql`first_day_of_week = ${patch.firstDayOfWeek}`);
  if (patch.locale !== undefined) sets.push(sql`locale = ${patch.locale}`);
  if (patch.recap !== undefined) sets.push(sql`recap = ${patch.recap}`);
  const updated = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${s.book} SET ${sql.join(sets, sql`, `)}
         WHERE id = ${bookId} AND ${inBook(database, sql`${s.book.id}`, accountId)} RETURNING id`,
  );
  if (updated.length === 0) return { ok: false, reason: 'not_found' };
  if (patch.baseCurrency !== undefined)
    await dbAll(
      database,
      sql`INSERT INTO ${s.bookCurrency} (book_id, code, created_at)
          SELECT b.id, ${patch.baseCurrency}, ${now} FROM ${s.book} b WHERE b.id = ${bookId} AND ${inBook(database, sql`b.id`, accountId)}
          ON CONFLICT (book_id, code) DO NOTHING RETURNING code`,
    );
  return { ok: true, id: bookId };
}
