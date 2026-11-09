import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { refusal } from '../ledger/transactions';
import type { TxnInput } from '../ledger/validate';
import { insertMovement } from './jars';

/**
 * Spending from a jar (DESIGN.md §10.2, task 7.3): an expense from the jar's account can be marked **from the jar**, and **the expense and a `spend` movement are one
 * transaction**, so neither exists without the other. The movement releases the amount the account paid (a negative movement pointing at the entry), under the
 * rule of 7.1: **the jar cannot go below zero**, a condition of the statement that writes it. The jar must be in the account that paid. Changing the expense changes
 * the movement, and deleting it deletes the movement, so the jar is as it was.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const invalid = (...problems: string[]) => ({ ok: false, reason: 'invalid', problems }) as const;

/** The jar an entry was paid from, if it was. */
export async function spendOf(
  tx: Database,
  accountId: string,
  bookId: string,
  txnId: string,
): Promise<string | undefined> {
  const s = schema(tx);
  const row = await dbGet<{ jarId: string }>(
    tx,
    sql`SELECT v.jar_id AS "jarId" FROM ${s.jarMovement} v
         WHERE v.txn_id = ${txnId} AND v.book_id = ${bookId} AND v.kind = 'spend' AND ${inBook(tx, sql`v.book_id`, accountId)}`,
  );
  return row?.jarId;
}

/** Writes the spend movement of an expense paid from a jar, on the handle of the transaction that writes the expense. Throws a refusal. */
export async function spendFromJar(
  tx: Database,
  accountId: string,
  bookId: string,
  txnId: string,
  input: TxnInput,
  jarId: string,
  now: number,
): Promise<void> {
  const s = schema(tx);
  const payer = input.lines.find((line) => line.account !== undefined);
  if (input.type !== 'expense' || !payer)
    throw refusal(invalid('Only an expense is paid from a jar.'));
  if (payer.amount >= 0) throw refusal(invalid('Money back is not paid from a jar.'));
  const jar = await dbGet<{ accountId: string }>(
    tx,
    sql`SELECT j.account_id AS "accountId" FROM ${s.jar} j
         WHERE j.id = ${jarId} AND j.book_id = ${bookId} AND ${inBook(tx, sql`j.book_id`, accountId)}`,
  );
  if (!jar) throw refusal({ ok: false, reason: 'not_found' });
  if (jar.accountId !== payer.account)
    throw refusal(invalid('That jar is not in the account that paid.'));
  await insertMovement(
    tx,
    accountId,
    bookId,
    { jarId, amount: payer.amount, date: input.date, kind: 'spend', txnId },
    now,
  );
}

/** Removes the spend movement of an entry, which is what deleting the entry does, and what changing the jar it was paid from starts with. */
export async function clearSpend(tx: Database, bookId: string, txnId: string): Promise<void> {
  const s = schema(tx);
  await dbAll(
    tx,
    sql`DELETE FROM ${s.jarMovement} WHERE txn_id = ${txnId} AND book_id = ${bookId} AND kind = 'spend' RETURNING id`,
  );
}
