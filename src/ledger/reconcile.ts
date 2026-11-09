import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { isCalendarDay } from '../dates';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { isMinor } from '../money/amount';
import { insertTransaction, refusal, runWrite, type WriteResult } from './transactions';

/**
 * Reconciling an account to its statement (DESIGN.md §6.4, §6.7): the person gives the statement's balance and date; every entry on the account up to that
 * date is then confirmed, so **all of them are marked cleared**, and what is still different between the statement and the account is recorded as **an
 * `adjustment`**, never as a hidden edit of another entry. **Reconciling again to the same figure records nothing:** there is no difference and nothing
 * pending. The marking, the difference and the adjustment are one transaction. Every statement carries the permission (`inBook`).
 *
 * The difference is taken against the balance of every entry up to the date, since confirming makes them all cleared: with a pending entry of −20.00 that
 * the statement already shows, a statement of 80.00 against a ledger of 100.00 is no difference, and not one more −20.00.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;

export interface ReconcileSummary {
  readonly currency: string;
  /** The account's balance on that day, every entry up to it counted: what the statement is to be compared with. */
  readonly balance: number;
  /** How many entries up to that day are still pending: what confirming marks cleared. */
  readonly pending: number;
}

/** What reconciling to a day would be compared with, or `undefined` for an account that is not theirs. */
export async function reconcileSummary(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
  date: string,
): Promise<ReconcileSummary | undefined> {
  if (!isCalendarDay(date)) throw new RangeError('reconcileSummary: not a day');
  const s = schema(database);
  const account = await dbGet<{ currency: string }>(
    database,
    sql`SELECT a.currency AS currency FROM ${s.moneyAccount} a
         WHERE a.id = ${moneyAccountId} AND a.book_id = ${bookId} AND ${inBook(database, sql`a.book_id`, accountId)}`,
  );
  if (!account) return undefined;
  const sums = await dbGet<{ balance: number | string | null; pending: number | string | null }>(
    database,
    sql`SELECT SUM(l.amount) AS balance,
               COUNT(DISTINCT CASE WHEN t.status = 'pending' THEN t.id END) AS pending
          FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
         WHERE l.account_id = ${moneyAccountId} AND l.book_id = ${bookId} AND t.date <= ${date}`,
  );
  return {
    currency: account.currency,
    balance: Number(sums?.balance ?? 0),
    pending: Number(sums?.pending ?? 0),
  };
}

export type ReconcileResult =
  | {
      readonly ok: true;
      /** The adjustment recorded, signed like a balance, or 0 when there was nothing to record. */
      readonly adjustment: number;
      /** How many pending entries were marked cleared. */
      readonly cleared: number;
    }
  | Extract<WriteResult, { ok: false }>;

/**
 * Reconciles the account to `balance` on `date`. `balance` is **signed like a balance**: what is owed on a card or a loan is below nothing. Entries on the
 * account dated on or before `date` are marked cleared; then the difference between the statement and the account is recorded as an adjustment dated `date`
 * (not written when there is none). Not theirs, not found; a day that is not one, or a balance that is not an amount, a sentence.
 */
export async function reconcile(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
  input: { date: string; balance: number },
  now: number = Date.now(),
): Promise<ReconcileResult> {
  if (typeof input.date !== 'string' || !isCalendarDay(input.date))
    return { ok: false, reason: 'invalid', problems: ['The statement needs the day it is of.'] };
  if (!isMinor(input.balance))
    return { ok: false, reason: 'invalid', problems: ['The statement balance is not an amount.'] };
  const s = schema(database);
  let outcome = { adjustment: 0, cleared: 0 };
  const result = await runWrite(database, async (tx) => {
    const account = await dbGet<{ currency: string }>(
      tx,
      sql`SELECT a.currency AS currency FROM ${s.moneyAccount} a
           WHERE a.id = ${moneyAccountId} AND a.book_id = ${bookId} AND ${inBook(tx, sql`a.book_id`, accountId)}`,
    );
    if (!account) throw refusal(NOT_FOUND);
    const cleared = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.txn} SET status = 'cleared', updated_at = ${now}
           WHERE book_id = ${bookId} AND ${inBook(tx, sql`${s.txn.bookId}`, accountId)}
             AND status = 'pending' AND date <= ${input.date}
             AND id IN (SELECT l.txn_id FROM ${s.txnLine} l WHERE l.account_id = ${moneyAccountId} AND l.book_id = ${bookId})
          RETURNING id`,
    );
    const sum = await dbGet<{ balance: number | string | null }>(
      tx,
      sql`SELECT SUM(l.amount) AS balance FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
           WHERE l.account_id = ${moneyAccountId} AND l.book_id = ${bookId} AND t.date <= ${input.date}`,
    );
    const difference = input.balance - Number(sum?.balance ?? 0);
    if (!isMinor(difference))
      throw refusal({
        ok: false,
        reason: 'invalid',
        problems: ['That difference is too large to record.'],
      });
    if (difference !== 0)
      await insertTransaction(
        tx,
        accountId,
        bookId,
        {
          type: 'adjustment',
          date: input.date,
          lines: [
            { account: moneyAccountId, amount: difference, currency: account.currency },
            { equity: 'adjustment', amount: -difference, currency: account.currency },
          ],
          note: 'Reconciled to the statement',
        },
        now,
      );
    outcome = { adjustment: difference, cleared: cleared.length };
    return moneyAccountId;
  });
  return result.ok ? { ok: true, ...outcome } : result;
}
