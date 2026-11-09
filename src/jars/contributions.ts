import { sql } from 'drizzle-orm';
import { monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { runWrite } from '../ledger/transactions';
import { insertMovement } from './jars';

/**
 * The monthly contributions (DESIGN.md §10.2, task 7.2): each jar's contribution **in force for the month** (its budget history, §7.3) is earmarked **once**
 * a month, by the book's own calendar, and **never partly**. The movement carries the month, and `(jar_id, month)` is unique, so a job run twice or by two
 * processes makes it once. If it does not fit in what is free in the account it is **skipped, and a movement of nothing marks the month as skipped** (so that
 * it is not tried again every hour, and Overview can say so): the rule of 7.1 decides, in the statement that writes it. A jar made this month starts next
 * month. Acts as the book's owner; a book with none is left alone.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export interface ContributeResult {
  readonly made: number;
  readonly skipped: number;
}

export async function contributeDue(
  database: Database,
  now: Date = new Date(),
): Promise<ContributeResult> {
  const s = schema(database);
  const jars = await dbAll<{
    id: string;
    bookId: string;
    timeZone: string;
    createdAt: number | string;
  }>(
    database,
    sql`SELECT j.id AS id, j.book_id AS "bookId", b.time_zone AS "timeZone", j.created_at AS "createdAt"
          FROM ${s.jar} j JOIN ${s.book} b ON b.id = j.book_id
         WHERE j.archived_at IS NULL
         ORDER BY j.book_id, j.created_at, j.id`,
  );
  const owners = new Map<string, string | undefined>();
  const result = { made: 0, skipped: 0 };
  for (const jar of jars) {
    if (!owners.has(jar.bookId)) {
      const owner = await dbGet<{ accountId: string }>(
        database,
        sql`SELECT m.account_id AS "accountId" FROM ${s.bookMember} m WHERE m.book_id = ${jar.bookId} AND m.role = 'owner' ORDER BY m.created_at LIMIT 1`,
      );
      owners.set(jar.bookId, owner?.accountId);
    }
    const owner = owners.get(jar.bookId);
    if (!owner) continue;
    const today = todayIn(jar.timeZone, now);
    const month = monthOf(today);
    // A jar made this month starts next month.
    if (monthOf(todayIn(jar.timeZone, new Date(Number(jar.createdAt)))) >= month) continue;
    const outcome = await contributeOne(
      database,
      owner,
      jar.bookId,
      jar.id,
      today,
      month,
      now.getTime(),
    );
    if (outcome === 'made') result.made++;
    else if (outcome === 'skipped') result.skipped++;
  }
  return result;
}

/** One jar's contribution for a month: `made`, `skipped` (and marked), or `none` (nothing to do: no contribution, or done already). */
async function contributeOne(
  database: Database,
  owner: string,
  bookId: string,
  jarId: string,
  today: string,
  month: string,
  now: number,
): Promise<'made' | 'skipped' | 'none'> {
  const s = schema(database);
  const [row, done] = await Promise.all([
    dbGet<{ amount: number | string }>(
      database,
      sql`SELECT b.amount AS amount FROM ${s.budgetAmount} b
           WHERE b.book_id = ${bookId} AND b.target_kind = 'jar' AND b.target_id = ${jarId} AND b.from_month <= ${month}
           ORDER BY b.from_month DESC LIMIT 1`,
    ),
    dbGet<{ id: string }>(
      database,
      sql`SELECT v.id AS id FROM ${s.jarMovement} v WHERE v.jar_id = ${jarId} AND v.book_id = ${bookId} AND v.month = ${month}`,
    ),
  ]);
  const amount = row ? Number(row.amount) : 0;
  if (amount <= 0 || done) return 'none';
  const write = (value: number) =>
    runWrite(database, (tx) =>
      insertMovement(
        tx,
        owner,
        bookId,
        { jarId, amount: value, date: today, kind: 'contribution', month },
        now,
      ),
    );
  const exists = async () =>
    (await dbGet<{ id: string }>(
      database,
      sql`SELECT v.id AS id FROM ${s.jarMovement} v WHERE v.jar_id = ${jarId} AND v.book_id = ${bookId} AND v.month = ${month}`,
    )) !== undefined;
  try {
    const made = await write(amount);
    if (made.ok) return 'made';
    // It does not fit in what is free (or the jar is gone): skipped, never partly made, and the month marked so that it is not tried again.
    if (made.reason !== 'invalid') return 'none';
    return (await write(0)).ok ? 'skipped' : 'none';
  } catch (error) {
    // Another process made it between the look and the write: the unique key says so, and that is the end of it.
    if (await exists()) return 'none';
    throw error;
  }
}
