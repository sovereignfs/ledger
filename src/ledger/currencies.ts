import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { isSupportedCurrencyCode } from '../money/currencies';
import { bookTable } from './books';

/**
 * The currencies a book uses (DESIGN.md §9.1). Every statement here carries the membership condition (`inBook`), so a book that is not the account's reads
 * as a book that is not there, and a code that is not an ISO 4217 one is refused before it is written.
 */
const table = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema.bookCurrency : sqliteSchema.bookCurrency;

/** The codes the account's book uses, in order; empty for a book that is not the account's. */
export async function listCurrencies(
  database: Database,
  accountId: string,
  bookId: string,
): Promise<string[]> {
  const rows = await dbAll<{ code: string }>(
    database,
    sql`SELECT c.code AS code FROM ${table(database)} c
         WHERE c.book_id = ${bookId} AND ${inBook(database, sql`c.book_id`, accountId)}
         ORDER BY c.code`,
  );
  return rows.map((row) => row.code);
}

export type AddCurrency = 'added' | 'exists' | 'unsupported' | 'not_found';

/**
 * Adds a currency to the account's book. `unsupported` for a code that is not a currency (no crypto, no made-up codes); `not_found` for a book that is not the
 * account's, which reads the same as one that does not exist; `exists` when it is there already, which is not an error and changes nothing.
 */
export async function addCurrency(
  database: Database,
  accountId: string,
  bookId: string,
  code: string,
  now: number = Date.now(),
): Promise<AddCurrency> {
  if (!isSupportedCurrencyCode(code)) return 'unsupported';
  const book = bookTable(database);
  const added = await dbAll<{ code: string }>(
    database,
    sql`INSERT INTO ${table(database)} (book_id, code, created_at)
        SELECT b.id, ${code}, ${now} FROM ${book} b
         WHERE b.id = ${bookId} AND ${inBook(database, sql`b.id`, accountId)}
        ON CONFLICT (book_id, code) DO NOTHING
        RETURNING code`,
  );
  if (added.length > 0) return 'added';
  const mine = await dbAll<{ id: string }>(
    database,
    sql`SELECT b.id AS id FROM ${book} b WHERE b.id = ${bookId} AND ${inBook(database, sql`b.id`, accountId)}`,
  );
  return mine.length > 0 ? 'exists' : 'not_found';
}
