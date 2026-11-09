import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { bookTable } from './books';

/**
 * The part of payees that a transaction needs (DESIGN.md §6.5): finding the payee a name means, or making it, and remembering what was last used with it. It
 * is apart from `payees.ts`, which manages them, so that the one write path can use it without a cycle.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export const MAX_PAYEE = 80;

/** What a payee is found by: the name trimmed, its inner spaces made one, and lowercased, so "Corner  Shop" and "corner shop" are one payee. */
export const payeeKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The name as it is kept and shown: trimmed, with its inner spaces made one. */
export const payeeName = (name: string): string => name.trim().replace(/\s+/g, ' ');

/** The sentence that says why a name may not be a payee's, or `undefined`. */
export function checkPayeeName(name: unknown): string | undefined {
  if (typeof name !== 'string' || name.trim() === '') return 'A payee needs a name.';
  if (payeeName(name).length > MAX_PAYEE)
    return `A payee's name is at most ${MAX_PAYEE} characters.`;
  return undefined;
}

/**
 * The id of the payee the name means in the account's book, **made if there is none** and brought back if it was archived: the first time a name is typed
 * it becomes a payee. The insert carries the permission and the book's unique name key, so two writes that make it at once make one payee. `undefined` when
 * the book is not the account's.
 */
export async function resolvePayee(
  tx: Database,
  accountId: string,
  bookId: string,
  name: string,
  now: number,
): Promise<string | undefined> {
  const s = schema(tx);
  const shown = payeeName(name);
  const key = payeeKey(name);
  await dbAll(
    tx,
    sql`INSERT INTO ${s.payee} (id, book_id, name, name_key, created_at)
        SELECT ${crypto.randomUUID()}, b.id, ${shown}, ${key}, ${now}
          FROM ${bookTable(tx)} b
         WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}
        ON CONFLICT (book_id, name_key) DO NOTHING
        RETURNING id`,
  );
  const found = await dbGet<{ id: string; archivedAt: number | string | null }>(
    tx,
    sql`SELECT p.id AS id, p.archived_at AS "archivedAt" FROM ${s.payee} p
         WHERE p.book_id = ${bookId} AND p.name_key = ${key} AND ${inBook(tx, sql`p.book_id`, accountId)}`,
  );
  if (!found) return undefined;
  if (found.archivedAt !== null)
    await dbAll(
      tx,
      sql`UPDATE ${s.payee} SET archived_at = NULL WHERE id = ${found.id} AND book_id = ${bookId} RETURNING id`,
    );
  return found.id;
}

/** Remembers what was last used with a payee: the subcategory (if the entry had one) and the account. What it replaces is what the dialog proposes next time. */
export async function rememberPayee(
  tx: Database,
  bookId: string,
  payeeId: string,
  last: { subcategoryId?: string; accountId?: string },
): Promise<void> {
  const s = schema(tx);
  await dbAll(
    tx,
    sql`UPDATE ${s.payee}
           SET last_subcategory_id = COALESCE(${last.subcategoryId ?? null}, last_subcategory_id),
               last_account_id = COALESCE(${last.accountId ?? null}, last_account_id)
         WHERE id = ${payeeId} AND book_id = ${bookId}
        RETURNING id`,
  );
}
