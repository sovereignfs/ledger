import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { isCalendarDay } from '../dates';
import type { Database } from '../db/client';
import { dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { isMinor } from '../money/amount';
import { insertTransaction, refusal, runWrite, type WriteResult } from './transactions';

/**
 * Giving an investment or a property a value (DESIGN.md §6.6): it is **valued, not traded**, so "value on a date" records a `revaluation` of the difference
 * between that value and what the account is worth on that day, against equity. **It is neither income nor spending**: its two lines are the account and
 * equity, so no subcategory and no income source is touched and no report of either moves; it shows in net worth as a change in value. Valuing it at what it
 * already is records nothing. Every statement carries the permission (`inBook`).
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;
const VALUED = ['investment', 'property'];

export type RevalueResult =
  | {
      readonly ok: true;
      /** The change in value recorded, signed, or 0 when it was worth that already and nothing was written. */
      readonly change: number;
    }
  | Extract<WriteResult, { ok: false }>;

/**
 * Values the account at `value` (minor units of its currency, never below nothing) on `date`. The change recorded is `value` less what the account is worth on
 * that day, every entry up to it counted. Only an investment or a property is valued, in a sentence; an account that is not theirs is not found.
 */
export async function revalue(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
  input: { date: string; value: number },
  now: number = Date.now(),
): Promise<RevalueResult> {
  if (typeof input.date !== 'string' || !isCalendarDay(input.date))
    return { ok: false, reason: 'invalid', problems: ['The value needs the day it is of.'] };
  if (!isMinor(input.value) || input.value < 0)
    return {
      ok: false,
      reason: 'invalid',
      problems: ['A value is an amount that is not below nothing.'],
    };
  const s = schema(database);
  let change = 0;
  const result = await runWrite(database, async (tx) => {
    const account = await dbGet<{ type: string; currency: string }>(
      tx,
      sql`SELECT a.type AS type, a.currency AS currency FROM ${s.moneyAccount} a
           WHERE a.id = ${moneyAccountId} AND a.book_id = ${bookId} AND ${inBook(tx, sql`a.book_id`, accountId)}`,
    );
    if (!account) throw refusal(NOT_FOUND);
    if (!VALUED.includes(account.type))
      throw refusal({
        ok: false,
        reason: 'invalid',
        problems: ['Only an investment or a property is given a value.'],
      });
    const sum = await dbGet<{ balance: number | string | null }>(
      tx,
      sql`SELECT SUM(l.amount) AS balance FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
           WHERE l.account_id = ${moneyAccountId} AND l.book_id = ${bookId} AND t.date <= ${input.date}`,
    );
    const difference = input.value - Number(sum?.balance ?? 0);
    if (!isMinor(difference))
      throw refusal({
        ok: false,
        reason: 'invalid',
        problems: ['That change is too large to record.'],
      });
    if (difference !== 0)
      await insertTransaction(
        tx,
        accountId,
        bookId,
        {
          type: 'revaluation',
          date: input.date,
          lines: [
            { account: moneyAccountId, amount: difference, currency: account.currency },
            { equity: 'revaluation', amount: -difference, currency: account.currency },
          ],
        },
        now,
      );
    change = difference;
    return moneyAccountId;
  });
  return result.ok ? { ok: true, change } : result;
}
