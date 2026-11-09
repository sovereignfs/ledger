import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { writeBudget } from '../budget/amounts';
import { loadRates } from '../fx/rates';
import { convertMinor, type RateSource } from '../money/convert';
import { listRecurring, type Template } from './recurring';
import { type Rule, monthlyEquivalent } from './rule';

/**
 * Bills in the budget (DESIGN.md §7.2, §8.4). A subcategory whose `budget_source` is `bills` is budgeted by its recurring entries: **the sum of their monthly
 * equivalents**, each in the currency of its lines, converted to the category's currency at the rate in force today, **rounded half to even**. Making,
 * changing or ending a recurring entry (and the last occurrence of one that ran out) writes that sum as the subcategory's budgeted amount **from the current
 * month**, in the same transaction, so a past month is never rewritten and the history works as it does for a budget set by hand (§7.3). A row is written only
 * when the figure in force is not already the sum. An entry whose amount cannot be converted for want of a rate is left out and counted, never counted as nothing.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export interface BillEntry {
  readonly template: Template;
  readonly rule: Pick<Rule, 'unit' | 'every'>;
}

/** The subcategories a template's lines are spent on. */
export const subcategoriesOf = (template: Template): string[] => [
  ...new Set(
    template.lines.flatMap((line) => (line.subcategory === undefined ? [] : [line.subcategory])),
  ),
];

/**
 * What the entries come to a month for one subcategory, in `currency`, **pure** over the entries and the rates: for each entry the lines on the subcategory
 * (a refund line, which is negative, is not a bill), its monthly equivalent in the lines' currency, converted on `today`. `notIncluded` counts the entries
 * left out for want of a rate.
 */
export function billsFigure(
  entries: readonly BillEntry[],
  subcategoryId: string,
  currency: string,
  today: string,
  rates: RateSource,
): { amount: number; notIncluded: number } {
  let amount = 0;
  let notIncluded = 0;
  for (const entry of entries) {
    const lines = entry.template.lines.filter((line) => line.subcategory === subcategoryId);
    const first = lines[0];
    if (!first) continue;
    const spent = lines.reduce((sum, line) => sum + line.amount, 0);
    if (spent <= 0 || lines.some((line) => line.currency !== first.currency)) continue;
    const converted = convertMinor(
      monthlyEquivalent(entry.rule, spent),
      first.currency,
      currency,
      today,
      rates,
    );
    if (converted === undefined) notIncluded++;
    else amount += converted;
  }
  return { amount, notIncluded };
}

/** The budgeted amount in force for a month, or `undefined` when none is yet. */
async function inForce(
  tx: Database,
  bookId: string,
  subcategoryId: string,
  month: string,
): Promise<number | undefined> {
  const s = schema(tx);
  const row = await dbGet<{ amount: number | string }>(
    tx,
    sql`SELECT b.amount AS amount FROM ${s.budgetAmount} b
         WHERE b.book_id = ${bookId} AND b.target_kind = 'subcategory' AND b.target_id = ${subcategoryId} AND b.from_month <= ${month}
         ORDER BY b.from_month DESC LIMIT 1`,
  );
  return row === undefined ? undefined : Number(row.amount);
}

/**
 * Writes, for each given subcategory that is budgeted by its bills, the sum of its recurring entries' monthly equivalents from the current month of the book
 * (by its own clock). Subcategories that are set by hand, or not the account's, are left alone. Call it inside the transaction that changed the entries.
 */
export async function syncBills(
  tx: Database,
  accountId: string,
  bookId: string,
  subcategoryIds: Iterable<string>,
  now: number,
): Promise<void> {
  const ids = [...new Set(subcategoryIds)];
  if (ids.length === 0) return;
  const s = schema(tx);
  const book = await dbGet<{ timeZone: string }>(
    tx,
    sql`SELECT b.time_zone AS "timeZone" FROM ${s.book} b WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}`,
  );
  if (!book) return;
  const today = todayIn(book.timeZone, new Date(now));
  const month = monthOf(today);
  const entries = (await listRecurring(tx, accountId, bookId)).filter(
    (row) => row.endedAt === null,
  );
  for (const id of ids) {
    const sub = await dbGet<{ currency: string }>(
      tx,
      sql`SELECT c.currency AS currency FROM ${s.subcategory} u JOIN ${s.category} c ON c.id = u.category_id AND c.book_id = u.book_id
           WHERE u.id = ${id} AND u.book_id = ${bookId} AND u.budget_source = 'bills' AND ${inBook(tx, sql`u.book_id`, accountId)}`,
    );
    if (!sub) continue;
    const mine = entries.filter((entry) => subcategoriesOf(entry.template).includes(id));
    const currencies = [
      sub.currency,
      ...mine.flatMap((entry) => entry.template.lines.map((line) => line.currency)),
    ];
    const rates = await loadRates(tx, currencies, today, today);
    const { amount } = billsFigure(mine, id, sub.currency, today, rates);
    if ((await inForce(tx, bookId, id, month)) === amount) continue;
    await writeBudget(
      tx,
      accountId,
      bookId,
      { kind: 'subcategory', targetId: id, amount, when: 'this', currentMonth: month },
      now,
    );
  }
}

/**
 * Chooses how a subcategory is budgeted: **by hand** or **by its bills**. Choosing bills writes the sum of its recurring entries from the current month
 * (nothing, which is a zero, when it has none); choosing by hand keeps the amount in force, which is then the person's to change. `not_found` for a
 * subcategory that is not the account's; repeating it changes nothing.
 */
export async function setBudgetSource(
  database: Database,
  accountId: string,
  bookId: string,
  subcategoryId: string,
  source: 'manual' | 'bills',
  now: number = Date.now(),
): Promise<boolean> {
  return transaction(database, async (tx) => {
    const s = schema(tx);
    const changed = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.subcategory} SET budget_source = ${source}
           WHERE id = ${subcategoryId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.subcategory.bookId}`, accountId)} RETURNING id`,
    );
    if (changed.length === 0) return false;
    if (source === 'bills') await syncBills(tx, accountId, bookId, [subcategoryId], now);
    return true;
  });
}
