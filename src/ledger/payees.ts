import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { checkPayeeName, payeeKey, payeeName } from './payee-write';
import { refusal, runWrite, type WriteResult } from './transactions';

/**
 * Payees (DESIGN.md §6.5): a name in the book, made the first time it is typed (`payee-write.ts`), offered by autocomplete after, and remembering the last
 * subcategory and account used with it. Here they are listed, found, renamed, **merged** (every entry moves to the survivor, in one transaction) and archived.
 * Every statement carries the permission (`inBook`); another person's payee is not there. A name is one payee in any case, held by the book's unique name key.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;

export interface PayeeRow {
  readonly id: string;
  readonly name: string;
  readonly lastSubcategoryId: string | null;
  readonly lastAccountId: string | null;
  readonly archivedAt: number | null;
  /** How many entries are on this payee. */
  readonly entries: number;
}

interface Raw {
  id: string;
  name: string;
  lastSubcategoryId: string | null;
  lastAccountId: string | null;
  archivedAt: number | string | null;
  entries: number | string;
}

const toRow = (row: Raw): PayeeRow => ({
  id: row.id,
  name: row.name,
  lastSubcategoryId: row.lastSubcategoryId,
  lastAccountId: row.lastAccountId,
  archivedAt: row.archivedAt === null ? null : Number(row.archivedAt),
  entries: Number(row.entries),
});

/** `%`, `_` and `\` in what is searched for are what they say, and not a pattern. */
const literal = (text: string) => text.replace(/[\\%_]/g, (mark) => `\\${mark}`);

/**
 * The account's payees by name, live or archived (`archived`), or only those whose name has `query` in it (any case): for the list, and for the autocomplete,
 * which asks as a person types. Empty for a book that is not theirs. `limit` is at most 200.
 */
export async function listPayees(
  database: Database,
  accountId: string,
  bookId: string,
  options: { archived?: boolean; query?: string; limit?: number } = {},
): Promise<PayeeRow[]> {
  const s = schema(database);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 200);
  const key = options.query?.trim() ? `%${literal(payeeKey(options.query))}%` : null;
  const rows = await dbAll<Raw>(
    database,
    sql`SELECT p.id AS id, p.name AS name, p.last_subcategory_id AS "lastSubcategoryId", p.last_account_id AS "lastAccountId",
               p.archived_at AS "archivedAt",
               (SELECT COUNT(*) FROM ${s.txn} t WHERE t.payee_id = p.id AND t.book_id = p.book_id) AS entries
          FROM ${s.payee} p
         WHERE p.book_id = ${bookId} AND ${inBook(database, sql`p.book_id`, accountId)}
           AND ${options.archived ? sql`p.archived_at IS NOT NULL` : sql`p.archived_at IS NULL`}
           ${key === null ? sql`` : sql`AND p.name_key LIKE ${key} ESCAPE '\\'`}
         ORDER BY p.name_key, p.id
         LIMIT ${limit}`,
  );
  return rows.map(toRow);
}

/** One payee, live or archived, or `undefined` for one that is not the account's. */
export async function getPayee(
  database: Database,
  accountId: string,
  bookId: string,
  payeeId: string,
): Promise<PayeeRow | undefined> {
  const s = schema(database);
  const row = await dbGet<Raw>(
    database,
    sql`SELECT p.id AS id, p.name AS name, p.last_subcategory_id AS "lastSubcategoryId", p.last_account_id AS "lastAccountId",
               p.archived_at AS "archivedAt",
               (SELECT COUNT(*) FROM ${s.txn} t WHERE t.payee_id = p.id AND t.book_id = p.book_id) AS entries
          FROM ${s.payee} p
         WHERE p.id = ${payeeId} AND p.book_id = ${bookId} AND ${inBook(database, sql`p.book_id`, accountId)}`,
  );
  return row ? toRow(row) : undefined;
}

/**
 * Renames a payee. A name another payee has (in any case) is a sentence that says to merge them instead; a change of case or spacing on its own is allowed.
 * One that is not the account's is not found.
 */
export async function renamePayee(
  database: Database,
  accountId: string,
  bookId: string,
  payeeId: string,
  name: string,
): Promise<WriteResult> {
  const problem = checkPayeeName(name);
  if (problem) return { ok: false, reason: 'invalid', problems: [problem] };
  const s = schema(database);
  return runWrite(database, async (tx) => {
    const updated = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.payee} SET name = ${payeeName(name)}, name_key = ${payeeKey(name)}
           WHERE id = ${payeeId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.payee.bookId}`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.payee} d WHERE d.book_id = ${bookId} AND d.id <> ${payeeId} AND d.name_key = ${payeeKey(name)})
          RETURNING id`,
    );
    if (updated.length > 0) return payeeId;
    const there = await getPayee(tx, accountId, bookId, payeeId);
    throw refusal(
      there
        ? {
            ok: false,
            reason: 'invalid',
            problems: ['There is already a payee with that name. Merge them instead.'],
          }
        : NOT_FOUND,
    );
  });
}

/** Archives a payee, or brings it back: out of the suggestions, still on its entries. `false` for one that is not the account's. Typing its name again brings it back too. */
export async function setPayeeArchived(
  database: Database,
  accountId: string,
  bookId: string,
  payeeId: string,
  archived: boolean,
  now: number = Date.now(),
): Promise<boolean> {
  const s = schema(database);
  const rows = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${s.payee} SET archived_at = ${archived ? sql`COALESCE(archived_at, ${now})` : null}
         WHERE id = ${payeeId} AND book_id = ${bookId} AND ${inBook(database, sql`${s.payee.bookId}`, accountId)} RETURNING id`,
  );
  return rows.length > 0;
}

/**
 * Merges `from` into `into`: **every entry moves to the survivor in one transaction**, the payee that is left behind goes, and the survivor keeps what it
 * remembered. Both must be the account's and different, else nothing changes and it is not found.
 */
export async function mergePayees(
  database: Database,
  accountId: string,
  bookId: string,
  from: string,
  into: string,
): Promise<boolean> {
  if (from === into) return false;
  const s = schema(database);
  const result = await runWrite(database, async (tx) => {
    const both = await dbAll<{ id: string }>(
      tx,
      sql`SELECT p.id AS id FROM ${s.payee} p
           WHERE p.book_id = ${bookId} AND ${inBook(tx, sql`p.book_id`, accountId)} AND p.id IN (${from}, ${into})`,
    );
    if (both.length !== 2) throw refusal(NOT_FOUND);
    await dbAll(
      tx,
      sql`UPDATE ${s.txn} SET payee_id = ${into} WHERE payee_id = ${from} AND book_id = ${bookId} RETURNING id`,
    );
    await dbAll(
      tx,
      sql`UPDATE ${s.payee} SET archived_at = NULL WHERE id = ${into} AND book_id = ${bookId} AND archived_at IS NOT NULL RETURNING id`,
    );
    await dbAll(
      tx,
      sql`DELETE FROM ${s.payee} WHERE id = ${from} AND book_id = ${bookId} RETURNING id`,
    );
    return into;
  });
  return result.ok;
}

export interface PayeeMonth {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly currency: string;
  /** Spent: the subcategory lines of its entries, so a refund takes off. */
  readonly spent: number;
  /** Received: the income-source lines of its entries, as a positive amount. */
  readonly received: number;
  readonly entries: number;
}

/** A payee's totals by month and currency, newest month first (DESIGN.md §6.5). Another person's payee has none. */
export async function payeeMonths(
  database: Database,
  accountId: string,
  bookId: string,
  payeeId: string,
): Promise<PayeeMonth[]> {
  const s = schema(database);
  const rows = await dbAll<{
    month: string;
    currency: string;
    spent: number | string | null;
    received: number | string | null;
    entries: number | string;
  }>(
    database,
    sql`SELECT substr(t.date, 1, 7) AS month, l.currency AS currency,
               SUM(CASE WHEN l.subcategory_id IS NOT NULL THEN l.amount ELSE 0 END) AS spent,
               -SUM(CASE WHEN l.income_source_id IS NOT NULL THEN l.amount ELSE 0 END) AS received,
               COUNT(DISTINCT t.id) AS entries
          FROM ${s.txn} t JOIN ${s.txnLine} l ON l.txn_id = t.id AND l.book_id = t.book_id
         WHERE t.payee_id = ${payeeId} AND t.book_id = ${bookId} AND ${inBook(database, sql`t.book_id`, accountId)}
           AND (l.subcategory_id IS NOT NULL OR l.income_source_id IS NOT NULL)
         GROUP BY substr(t.date, 1, 7), l.currency
         ORDER BY month DESC, l.currency`,
  );
  return rows.map((row) => ({
    month: row.month,
    currency: row.currency,
    spent: Number(row.spent ?? 0),
    received: Number(row.received ?? 0),
    entries: Number(row.entries),
  }));
}
