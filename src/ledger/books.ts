import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbGet, dbRun, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { LEDGER_NAMESPACE, uuid5 } from '../uuid5';

/**
 * A book, and the one way a person comes to have one (DESIGN.md §5.3). Everything a person budgets belongs to a book, and what a person may touch is the
 * rows of the books they are a member of (`src/access/book.ts`). Phase 1 has one book for each person and no way to make another or to add a member.
 */
export interface Book {
  id: string;
  name: string;
  /** The currency of totals and reports, or null until setup chooses one. */
  baseCurrency: string | null;
  timeZone: string;
  firstDayOfWeek: number;
  locale: string | null;
  recap: boolean;
  /** When setup was finished, or null while it is not. */
  setupDoneAt: number | null;
}

export const bookTable = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema.book : sqliteSchema.book;
export const memberTable = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema.bookMember : sqliteSchema.bookMember;

/**
 * **A person's book has an id made from theirs**, so two requests that find there is none make the same row and only one makes it (the second finds
 * its insert already done): there is no check and then a write that two could pass together. The id is a name-based UUID, and its namespace is this
 * app's own.
 */
export const bookIdFor = (accountId: string): string =>
  uuid5(`book:${accountId}`, LEDGER_NAMESPACE);

interface BookRow {
  id: string;
  name: string;
  baseCurrency: string | null;
  timeZone: string;
  firstDayOfWeek: number | string;
  locale: string | null;
  recap: number | boolean;
  setupDoneAt: number | string | null;
}

const toBook = (row: BookRow): Book => ({
  id: row.id,
  name: row.name,
  baseCurrency: row.baseCurrency,
  timeZone: row.timeZone,
  firstDayOfWeek: Number(row.firstDayOfWeek),
  locale: row.locale,
  recap: Boolean(row.recap),
  setupDoneAt: row.setupDoneAt === null ? null : Number(row.setupDoneAt),
});

/**
 * The book of an account, if it has one. **The read is the account's own**: it joins through membership, so asking for an account's book is asking
 * for a book that account is a member of, and nothing else.
 */
export async function findBook(database: Database, accountId: string): Promise<Book | undefined> {
  const book = bookTable(database);
  const member = memberTable(database);
  const row = await dbGet<BookRow>(
    database,
    sql`SELECT b.id AS id, b.name AS name, b.base_currency AS "baseCurrency", b.time_zone AS "timeZone",
               b.first_day_of_week AS "firstDayOfWeek", b.locale AS locale, b.recap AS recap,
               b.setup_done_at AS "setupDoneAt"
          FROM ${book} b
         WHERE EXISTS (SELECT 1 FROM ${member} m WHERE m.book_id = b.id AND m.account_id = ${accountId})
         ORDER BY b.created_at, b.id
         LIMIT 1`,
  );
  return row ? toBook(row) : undefined;
}

/**
 * The account's book, made first if there is none: called by every page and action that needs one (`requireBook`), so no step of sign-up has to make
 * it and a person who signed in before it existed gets it at their next request. Safe to run twice and at once (see `bookIdFor`).
 */
export async function ensureBook(
  database: Database,
  accountId: string,
  now: number = Date.now(),
): Promise<Book> {
  const found = await findBook(database, accountId);
  if (found) return found;
  const id = bookIdFor(accountId);
  const book = bookTable(database);
  const member = memberTable(database);
  await transaction(database, async (tx) => {
    await dbRun(
      tx,
      sql`INSERT INTO ${book} (id, name, base_currency, time_zone, first_day_of_week, locale, recap, setup_done_at, created_at, updated_at)
          VALUES (${id}, ${'My budget'}, ${null}, ${'UTC'}, ${1}, ${null}, ${true}, ${null}, ${now}, ${now})
          ON CONFLICT (id) DO NOTHING`,
    );
    await dbRun(
      tx,
      sql`INSERT INTO ${member} (book_id, account_id, role, created_at)
          VALUES (${id}, ${accountId}, ${'owner'}, ${now})
          ON CONFLICT (book_id, account_id) DO NOTHING`,
    );
  });
  const made = await findBook(database, accountId);
  if (!made) throw new Error('the book could not be made');
  return made;
}
