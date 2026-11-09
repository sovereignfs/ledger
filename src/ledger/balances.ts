import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { isCalendarDay } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { assertMinor } from '../money/amount';

/**
 * **A balance is derived, never written** (DESIGN.md §6.1, AGENTS.md): it is the sum of an account's lines, on or before a date. Nothing stores it and
 * nothing edits it; a correction is an `adjustment` transaction (§6.4). Every statement carries the permission (`inBook`), so another person's account
 * has no balance: it reads as an account with no lines, which is what an account that is not there has.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

/** A sum as the database gives it (PostgreSQL's `SUM` of a `bigint` is text) turned into an amount, which must be exact. */
const amount = (value: number | string | null): number => {
  const n = value === null ? 0 : Number(value);
  assertMinor(n, 'a balance');
  return n;
};

/** The balances of the account's accounts in a book, each the sum of its lines on or before `asOf` (every date when none is given). An account with no lines has none listed. */
export async function balancesOf(
  database: Database,
  accountId: string,
  bookId: string,
  asOf?: string,
): Promise<Map<string, number>> {
  if (asOf !== undefined && !isCalendarDay(asOf)) throw new RangeError('balancesOf: not a day');
  const s = schema(database);
  const rows = await dbAll<{ id: string; total: number | string | null }>(
    database,
    sql`SELECT l.account_id AS id, SUM(l.amount) AS total
          FROM ${s.txnLine} l
          JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
         WHERE l.book_id = ${bookId} AND ${inBook(database, sql`l.book_id`, accountId)}
           AND l.account_id IS NOT NULL
           ${asOf === undefined ? sql`` : sql`AND t.date <= ${asOf}`}
         GROUP BY l.account_id`,
  );
  return new Map(rows.map((row) => [row.id, amount(row.total)]));
}

/** One account's balance, in its own currency's minor units, on or before `asOf`: zero for an account with no lines, and for one that is not the person's. */
export async function balanceOf(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
  asOf?: string,
): Promise<number> {
  return (await balancesOf(database, accountId, bookId, asOf)).get(moneyAccountId) ?? 0;
}
