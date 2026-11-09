import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import type { TxnStatus } from './validate';

/**
 * What can be done to several entries at once (DESIGN.md §6.9): mark them cleared or pending, move them to another subcategory, delete them. **Each statement
 * carries the permission** and names the entries it touches: an id that is not the account's changes nothing and is counted as skipped, which reads the same as
 * one that is not there. At most 200 entries at a time. Nothing here can make an entry that does not add up: it changes a status, changes which subcategory a
 * line points at, or removes an entry with its lines.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export const MAX_BULK = 200;

export interface BulkResult {
  /** How many were changed. */
  readonly changed: number;
  /** How many of those asked for were not: not the account's, not there, or not able to take the change. */
  readonly skipped: number;
}

const list = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/** The ids asked for, once each; `undefined` if there are none, too many, or one that is not text. */
function asked(ids: readonly unknown[]): string[] | undefined {
  if (ids.length === 0 || ids.length > MAX_BULK) return undefined;
  if (!ids.every((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64))
    return undefined;
  return [...new Set(ids)];
}

/** Marks the entries pending or cleared (DESIGN.md §6.7). A status changes no figure. */
export async function bulkSetStatus(
  database: Database,
  accountId: string,
  bookId: string,
  ids: readonly unknown[],
  status: TxnStatus,
  now: number = Date.now(),
): Promise<BulkResult | undefined> {
  const wanted = asked(ids);
  if (!wanted || (status !== 'pending' && status !== 'cleared')) return undefined;
  const s = schema(database);
  const rows = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${s.txn} SET status = ${status}, updated_at = ${now}
         WHERE book_id = ${bookId} AND ${inBook(database, sql`${s.txn.bookId}`, accountId)} AND id IN (${list(wanted)})
        RETURNING id`,
  );
  return { changed: rows.length, skipped: wanted.length - rows.length };
}

/**
 * Moves the entries to another subcategory, which must be the book's and live. **Only an entry with exactly one subcategory line is moved**: an entry split in
 * parts has its parts chosen one by one, and an income or a transfer has none; those are skipped and counted.
 */
export async function bulkRecategorise(
  database: Database,
  accountId: string,
  bookId: string,
  ids: readonly unknown[],
  subcategoryId: string,
  now: number = Date.now(),
): Promise<BulkResult | undefined> {
  const wanted = asked(ids);
  if (!wanted || typeof subcategoryId !== 'string' || subcategoryId === '') return undefined;
  const s = schema(database);
  return transaction(database, async (tx) => {
    const moved = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.txnLine} SET subcategory_id = ${subcategoryId}
           WHERE book_id = ${bookId} AND ${inBook(tx, sql`${s.txnLine.bookId}`, accountId)}
             AND subcategory_id IS NOT NULL AND txn_id IN (${list(wanted)})
             AND EXISTS (SELECT 1 FROM ${s.subcategory} c JOIN ${s.category} g ON g.id = c.category_id AND g.book_id = c.book_id
                          WHERE c.id = ${subcategoryId} AND c.book_id = ${bookId} AND c.archived_at IS NULL AND g.archived_at IS NULL)
             AND (SELECT COUNT(*) FROM ${s.txnLine} y WHERE y.txn_id = ${s.txnLine.txnId} AND y.book_id = ${bookId}
                    AND y.subcategory_id IS NOT NULL) = 1
          RETURNING txn_id AS id`,
    );
    if (moved.length > 0)
      await dbAll(
        tx,
        sql`UPDATE ${s.txn} SET updated_at = ${now}
             WHERE book_id = ${bookId} AND id IN (${list(moved.map((row) => row.id))}) RETURNING id`,
      );
    return { changed: moved.length, skipped: wanted.length - moved.length };
  });
}

/** Deletes the entries with their lines, in one transaction: an id that is not the account's is left alone and counted as skipped. */
export async function bulkDelete(
  database: Database,
  accountId: string,
  bookId: string,
  ids: readonly unknown[],
): Promise<BulkResult | undefined> {
  const wanted = asked(ids);
  if (!wanted) return undefined;
  const s = schema(database);
  return transaction(database, async (tx) => {
    const gone = await dbAll<{ id: string }>(
      tx,
      sql`DELETE FROM ${s.txn}
           WHERE book_id = ${bookId} AND ${inBook(tx, sql`${s.txn.bookId}`, accountId)} AND id IN (${list(wanted)})
          RETURNING id`,
    );
    if (gone.length > 0) {
      await dbAll(
        tx,
        sql`DELETE FROM ${s.txnLine} WHERE book_id = ${bookId} AND txn_id IN (${list(gone.map((row) => row.id))}) RETURNING id`,
      );
      // Entries paid from a jar take their movements with them, so the jars hold what they did.
      await dbAll(
        tx,
        sql`DELETE FROM ${s.jarMovement} WHERE book_id = ${bookId} AND kind = 'spend' AND txn_id IN (${list(gone.map((row) => row.id))}) RETURNING id`,
      );
    }
    return { changed: gone.length, skipped: wanted.length - gone.length };
  });
}
