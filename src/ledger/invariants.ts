import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';

/**
 * What must be true of every transaction a book holds, **asked of the rows themselves** and not of the code that wrote them (DESIGN.md §6.2, §6.3): the check
 * of the property test, and of import and export when they come. It names no amount and no one's thing; an id and a kind of fault are enough to find it.
 *
 *  - every line names exactly one target;
 *  - the lines of an entry add up to zero in each currency, except an entry of two currencies, which must be a transfer of two lines;
 *  - an entry has lines, and a line has an entry.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export interface Violation {
  readonly kind:
    | 'line_without_one_target'
    | 'entry_does_not_add_up'
    | 'two_currencies_not_a_transfer'
    | 'entry_without_lines'
    | 'line_without_entry';
  readonly id: string;
}

/** Every violation in the book (ids of lines or entries); empty when the book is whole. Reads across the whole book, for tests and for export. */
export async function findViolations(database: Database, bookId: string): Promise<Violation[]> {
  const s = schema(database);
  const found: Violation[] = [];
  const add = (kind: Violation['kind'], rows: { id: string }[]) =>
    rows.forEach((row) => found.push({ kind, id: row.id }));

  add(
    'line_without_one_target',
    await dbAll<{ id: string }>(
      database,
      sql`SELECT l.id AS id FROM ${s.txnLine} l
           WHERE l.book_id = ${bookId}
             AND (CASE WHEN l.account_id IS NULL THEN 0 ELSE 1 END
                + CASE WHEN l.subcategory_id IS NULL THEN 0 ELSE 1 END
                + CASE WHEN l.income_source_id IS NULL THEN 0 ELSE 1 END
                + CASE WHEN l.equity IS NULL THEN 0 ELSE 1 END) <> 1`,
    ),
  );
  add(
    'entry_does_not_add_up',
    await dbAll<{ id: string }>(
      database,
      sql`SELECT t.id AS id FROM ${s.txn} t
           WHERE t.book_id = ${bookId}
             AND (SELECT COUNT(DISTINCT l.currency) FROM ${s.txnLine} l WHERE l.txn_id = t.id AND l.book_id = t.book_id) = 1
             AND (SELECT SUM(l.amount) FROM ${s.txnLine} l WHERE l.txn_id = t.id AND l.book_id = t.book_id) <> 0`,
    ),
  );
  add(
    'two_currencies_not_a_transfer',
    await dbAll<{ id: string }>(
      database,
      sql`SELECT t.id AS id FROM ${s.txn} t
           WHERE t.book_id = ${bookId}
             AND (SELECT COUNT(DISTINCT l.currency) FROM ${s.txnLine} l WHERE l.txn_id = t.id AND l.book_id = t.book_id) > 1
             AND (t.type <> 'transfer'
                  OR (SELECT COUNT(*) FROM ${s.txnLine} l WHERE l.txn_id = t.id AND l.book_id = t.book_id) <> 2)`,
    ),
  );
  add(
    'entry_without_lines',
    await dbAll<{ id: string }>(
      database,
      sql`SELECT t.id AS id FROM ${s.txn} t
           WHERE t.book_id = ${bookId}
             AND NOT EXISTS (SELECT 1 FROM ${s.txnLine} l WHERE l.txn_id = t.id AND l.book_id = t.book_id)`,
    ),
  );
  add(
    'line_without_entry',
    await dbAll<{ id: string }>(
      database,
      sql`SELECT l.id AS id FROM ${s.txnLine} l
           WHERE l.book_id = ${bookId}
             AND NOT EXISTS (SELECT 1 FROM ${s.txn} t WHERE t.id = l.txn_id AND t.book_id = l.book_id)`,
    ),
  );
  return found;
}
