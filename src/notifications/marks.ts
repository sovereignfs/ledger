import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';

/**
 * **The claim a job makes before it sends** (DESIGN.md §11.5, §13.4): one row for `(book, kind, mark)`, made by an insert that does nothing when the row is there, so that a job
 * run twice, or by two processes at once, does the thing once and the loser is told so. It is made **before** the send, so a send whose answer was lost is never made again:
 * a notice is at most once. `kind` is `upcoming` (the day), `insight` (the insight and the month) or `recap` (the month).
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export type MarkKind = 'upcoming' | 'insight' | 'recap';

/** Claims `(book, kind, mark)` for the account's book: `true` for the one that made the row, `false` for any other and for a book that is not the account's. */
export async function claimMark(
  database: Database,
  accountId: string,
  bookId: string,
  kind: MarkKind,
  mark: string,
  now: number,
): Promise<boolean> {
  const s = schema(database);
  const made = await dbAll<{ kind: string }>(
    database,
    sql`INSERT INTO ${s.bookJobMark} (book_id, kind, mark, created_at)
        SELECT b.id, ${kind}, ${mark}, ${now} FROM ${s.book} b
         WHERE b.id = ${bookId} AND ${inBook(database, sql`b.id`, accountId)}
        ON CONFLICT (book_id, kind, mark) DO NOTHING RETURNING kind`,
  );
  return made.length > 0;
}
