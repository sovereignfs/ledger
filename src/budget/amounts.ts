import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { addMonths, isMonth } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { isMinor } from '../money/amount';
import type { BudgetRow } from './budget-for';
import type { WriteResult } from '../ledger/transactions';

/**
 * Budgeted amounts with their history (DESIGN.md §7.3). A change **writes a row from a month on and never rewrites a past one**: it is "from this month" or
 * "from next month", and the month is the book's own, given by the caller from the book's clock. Two changes for the same month keep the later; a budget that
 * ends writes a zero. Every statement carries the permission (`inBook`), and the target (a subcategory or an income source) must be the same book's in the
 * statement that writes the row, so another person's id reads as one that is not there. Jars take this table too (task 7.1); until they exist their kind is
 * not accepted.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export const TARGET_KINDS = ['subcategory', 'income'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export type When = 'this' | 'next';

export const isTargetKind = (value: unknown): value is TargetKind =>
  typeof value === 'string' && (TARGET_KINDS as readonly string[]).includes(value);

/** The month a change takes effect from: the book's current month, or the one after. Never an earlier one. */
export const effectiveMonth = (currentMonth: string, when: When): string =>
  when === 'next' ? addMonths(currentMonth, 1) : currentMonth;

/**
 * Sets the budgeted amount of a target (minor units of its currency, not below nothing) from this month or from next, given the book's `currentMonth`. A zero
 * is a budget that has ended. An existing row for the same month is replaced (the later change wins); no earlier month is ever written. `not_found` for a target
 * that is not the account's.
 */
export async function setBudget(
  database: Database,
  accountId: string,
  bookId: string,
  input: { kind: TargetKind; targetId: string; amount: number; when: When; currentMonth: string },
  now: number = Date.now(),
): Promise<WriteResult> {
  if (!isTargetKind(input.kind))
    return {
      ok: false,
      reason: 'invalid',
      problems: ['A budget is for a subcategory or an income source.'],
    };
  if (!isMinor(input.amount) || input.amount < 0)
    return { ok: false, reason: 'invalid', problems: ['A budgeted amount is not below nothing.'] };
  if (input.when !== 'this' && input.when !== 'next')
    return {
      ok: false,
      reason: 'invalid',
      problems: ['A change is from this month or from next month.'],
    };
  if (!isMonth(input.currentMonth)) throw new RangeError('setBudget: not a month');
  if (typeof input.targetId !== 'string' || input.targetId === '' || input.targetId.length > 64)
    return { ok: false, reason: 'not_found' };
  const s = schema(database);
  const from = effectiveMonth(input.currentMonth, input.when);
  const target =
    input.kind === 'subcategory'
      ? sql`SELECT t.id AS id, t.book_id AS book_id FROM ${s.subcategory} t`
      : sql`SELECT t.id AS id, t.book_id AS book_id FROM ${s.incomeSource} t`;
  const written = await dbAll<{ id: string }>(
    database,
    sql`INSERT INTO ${s.budgetAmount} (book_id, target_kind, target_id, from_month, amount, created_at)
        SELECT x.book_id, ${input.kind}, x.id, ${from}, ${input.amount}, ${now}
          FROM (${target}) x
         WHERE x.id = ${input.targetId} AND x.book_id = ${bookId} AND ${inBook(database, sql`x.book_id`, accountId)}
        ON CONFLICT (book_id, target_kind, target_id, from_month) DO UPDATE SET amount = excluded.amount, created_at = excluded.created_at
        RETURNING target_id AS id`,
  );
  return written.length > 0 ? { ok: true, id: input.targetId } : { ok: false, reason: 'not_found' };
}

/** A budget that ends: a zero from this month or next, which is how a row says there is no budget from then on. */
export function endBudget(
  database: Database,
  accountId: string,
  bookId: string,
  input: { kind: TargetKind; targetId: string; when: When; currentMonth: string },
  now?: number,
): Promise<WriteResult> {
  return setBudget(database, accountId, bookId, { ...input, amount: 0 }, now);
}

/** A target's rows, oldest first: its budget history. Another person's target has none. */
export async function budgetHistory(
  database: Database,
  accountId: string,
  bookId: string,
  kind: TargetKind,
  targetId: string,
): Promise<(BudgetRow & { createdAt: number })[]> {
  const s = schema(database);
  const rows = await dbAll<{
    fromMonth: string;
    amount: number | string;
    createdAt: number | string;
  }>(
    database,
    sql`SELECT b.from_month AS "fromMonth", b.amount AS amount, b.created_at AS "createdAt"
          FROM ${s.budgetAmount} b
         WHERE b.book_id = ${bookId} AND ${inBook(database, sql`b.book_id`, accountId)}
           AND b.target_kind = ${kind} AND b.target_id = ${targetId}
         ORDER BY b.from_month`,
  );
  return rows.map((row) => ({
    fromMonth: row.fromMonth,
    amount: Number(row.amount),
    createdAt: Number(row.createdAt),
  }));
}

/**
 * Every target's budgeted amount **in force for a month**, in one statement: the row of each target with the latest `from_month` not after it. Keyed
 * `<kind>:<id>`; a target with no row in force yet is absent, which is not a budget of nothing. This is the figure the budget screen and the reports share.
 */
export async function budgetsForMonth(
  database: Database,
  accountId: string,
  bookId: string,
  month: string,
): Promise<Map<string, number>> {
  if (!isMonth(month)) throw new RangeError('budgetsForMonth: not a month');
  const s = schema(database);
  const rows = await dbAll<{ kind: string; id: string; amount: number | string }>(
    database,
    sql`SELECT b.target_kind AS kind, b.target_id AS id, b.amount AS amount
          FROM ${s.budgetAmount} b
         WHERE b.book_id = ${bookId} AND ${inBook(database, sql`b.book_id`, accountId)}
           AND b.from_month = (SELECT MAX(x.from_month) FROM ${s.budgetAmount} x
                                WHERE x.book_id = b.book_id AND x.target_kind = b.target_kind AND x.target_id = b.target_id
                                  AND x.from_month <= ${month})`,
  );
  return new Map(rows.map((row) => [`${row.kind}:${row.id}`, Number(row.amount)]));
}
