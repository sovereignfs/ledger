import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { addMonths, isMonth, monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import type { Book } from '../ledger/books';
import type { WriteResult } from '../ledger/transactions';

/**
 * The month-end review (DESIGN.md §11.4): **a past month without a review is "Needs review"**, the current month is in progress, and a month the person has marked is reviewed.
 * Marking is **idempotent** (one row for a book and a month, however many times) and **can be undone**. Overview shows a banner for the most recent past month that needs review.
 * What the status of a month is, and which month the banner is for, are **pure**; the rest reads and writes the one table, under the permission of the statement.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export type ReviewStatus = 'in_progress' | 'reviewed' | 'needs_review';

export function reviewStatus(
  month: string,
  current: string,
  reviewed: ReadonlySet<string>,
): ReviewStatus {
  if (month >= current) return 'in_progress';
  return reviewed.has(month) ? 'reviewed' : 'needs_review';
}

/** The months from the one of the first entry up to the last one that is over, newest first: the months there is anything to review in. */
export function pastMonths(firstMonth: string | null, current: string): string[] {
  if (firstMonth === null || firstMonth >= current) return [];
  const out: string[] = [];
  for (let month = addMonths(current, -1); month >= firstMonth; month = addMonths(month, -1))
    out.push(month);
  return out;
}

/** The most recent past month without a review, which Overview's banner is for; `null` when there is none. */
export function monthNeedingReview(
  firstMonth: string | null,
  current: string,
  reviewed: ReadonlySet<string>,
): string | null {
  return pastMonths(firstMonth, current).find((month) => !reviewed.has(month)) ?? null;
}

/** The months the account's book has reviewed. */
export async function reviewedMonths(
  database: Database,
  accountId: string,
  bookId: string,
): Promise<Set<string>> {
  const s = schema(database);
  const rows = await dbAll<{ month: string }>(
    database,
    sql`SELECT r.month AS month FROM ${s.monthReview} r
         WHERE r.book_id = ${bookId} AND ${inBook(database, sql`r.book_id`, accountId)} ORDER BY r.month`,
  );
  return new Set(rows.map((row) => row.month));
}

/** The month of the book's first entry, or `null` while it has none. */
export async function firstEntryMonth(
  database: Database,
  accountId: string,
  bookId: string,
): Promise<string | null> {
  const s = schema(database);
  const rows = await dbAll<{ date: string | null }>(
    database,
    sql`SELECT MIN(t.date) AS date FROM ${s.txn} t WHERE t.book_id = ${bookId} AND ${inBook(database, sql`t.book_id`, accountId)}`,
  );
  const date = rows[0]?.date;
  return date ? monthOf(date) : null;
}

/**
 * Marks a month reviewed, or undoes it. **Only a month that is over** is reviewed (by the book's own calendar, given as `today`): a month in progress, or still to come, is a
 * sentence. Marking a month that is marked, or undoing one that is not, changes nothing and is not an error. `not_found` for a book that is not the account's.
 */
export async function setReviewed(
  database: Database,
  accountId: string,
  bookId: string,
  month: string,
  reviewed: boolean,
  today: string,
  now: number = Date.now(),
): Promise<WriteResult> {
  if (typeof month !== 'string' || !isMonth(month))
    return { ok: false, reason: 'invalid', problems: ['A month is written like 2026-11.'] };
  if (month >= monthOf(today))
    return {
      ok: false,
      reason: 'invalid',
      problems: ['A month is reviewed once it is over.'],
    };
  const s = schema(database);
  const there = await dbAll<{ id: string }>(
    database,
    sql`SELECT b.id AS id FROM ${s.book} b WHERE b.id = ${bookId} AND ${inBook(database, sql`b.id`, accountId)}`,
  );
  if (there.length === 0) return { ok: false, reason: 'not_found' };
  if (reviewed)
    await dbAll(
      database,
      sql`INSERT INTO ${s.monthReview} (book_id, month, reviewed_at, reviewed_by)
          SELECT b.id, ${month}, ${now}, ${accountId} FROM ${s.book} b
           WHERE b.id = ${bookId} AND ${inBook(database, sql`b.id`, accountId)}
          ON CONFLICT (book_id, month) DO NOTHING RETURNING month`,
    );
  else
    await dbAll(
      database,
      sql`DELETE FROM ${s.monthReview}
           WHERE book_id = ${bookId} AND month = ${month} AND ${inBook(database, sql`${s.monthReview.bookId}`, accountId)}
          RETURNING month`,
    );
  return { ok: true, id: month };
}

/** The banner Overview shows: the most recent past month that needs a review, by the book's own calendar; `null` when none does. */
export async function loadReviewBanner(
  database: Database,
  accountId: string,
  book: Book,
  now: Date = new Date(),
): Promise<string | null> {
  const [first, reviewed] = await Promise.all([
    firstEntryMonth(database, accountId, book.id),
    reviewedMonths(database, accountId, book.id),
  ]);
  return monthNeedingReview(first, monthOf(todayIn(book.timeZone, now)), reviewed);
}
