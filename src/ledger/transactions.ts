import { type SQL, sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { bookTable } from './books';
import { rememberPayee, resolvePayee } from './payee-write';
import {
  type AccountFacts,
  type LineInput,
  type TxnInput,
  checkAccounts,
  checkShape,
  defaultStatus,
  targetOf,
} from './validate';

/**
 * **The one path every transaction is written through** (DESIGN.md §6.2, AGENTS.md): the add dialog, a recurring entry, a jar's movement, a loan instalment
 * and import all come here, so the invariants are held in one place. A write is checked (`./validate.ts`: lines that add up, one target each, the targets a
 * type may have), and then written in one transaction, **each statement carrying the permission**: the book is the account's (`inBook`), and everything a line
 * points at is the same book's, in the statement that writes the line (§5.2). Anything that is not the account's reads as not found, as a row that never was.
 *
 * Editing replaces the lines in the same transaction as the entry's own row, so no other statement ever sees an entry half-changed. A transaction that is
 * refused writes nothing.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export type WriteResult =
  | { readonly ok: true; readonly id: string }
  /** What is wrong, in sentences a person can read; nothing was written. */
  | { readonly ok: false; readonly reason: 'invalid'; readonly problems: readonly string[] }
  /** The book, the entry or something a line points at is not the account's. It reads as a thing that is not there. */
  | { readonly ok: false; readonly reason: 'not_found' };

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;

/** Thrown inside the transaction to undo it; never leaves this file. */
class Refused extends Error {
  constructor(readonly result: Extract<WriteResult, { ok: false }>) {
    super('refused');
  }
}

/** The ids a transaction's lines point at, by kind, without repeats. */
function targets(lines: readonly LineInput[]) {
  const unique = (values: (string | undefined)[]) => [
    ...new Set(values.filter((each): each is string => each !== undefined)),
  ];
  return {
    accounts: unique(lines.map((line) => line.account)),
    subcategories: unique(lines.map((line) => line.subcategory)),
    incomeSources: unique(lines.map((line) => line.incomeSource)),
  };
}

const list = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/**
 * What the accounts the lines name are, **read in the book and as the account's own**; and whether every subcategory and income source is the book's. Anything
 * missing is `not_found`: it is not told apart from something that belongs to someone else. This read is for the sentences (an account's type and currency); the
 * statements that write the lines carry the same condition themselves, so a change between the two cannot let a line through.
 */
async function resolve(
  tx: Database,
  accountId: string,
  bookId: string,
  lines: readonly LineInput[],
): Promise<{ facts: AccountFacts; archivedSubcategories: string[] } | undefined> {
  const s = schema(tx);
  const wanted = targets(lines);
  const facts = new Map<string, { type: string; currency: string }>();
  if (wanted.accounts.length > 0) {
    const rows = await dbAll<{ id: string; type: string; currency: string }>(
      tx,
      sql`SELECT a.id AS id, a.type AS type, a.currency AS currency FROM ${s.moneyAccount} a
           WHERE a.book_id = ${bookId} AND ${inBook(tx, sql`a.book_id`, accountId)} AND a.id IN (${list(wanted.accounts)})`,
    );
    for (const row of rows) facts.set(row.id, { type: row.type, currency: row.currency });
    if (facts.size !== wanted.accounts.length) return undefined;
  }
  const counted = async (table: SQL, ids: readonly string[]) => {
    if (ids.length === 0) return true;
    const rows = await dbAll<{ id: string }>(
      tx,
      sql`SELECT t.id AS id FROM ${table} t
           WHERE t.book_id = ${bookId} AND ${inBook(tx, sql`t.book_id`, accountId)} AND t.id IN (${list(ids)})`,
    );
    return rows.length === ids.length;
  };
  if (!(await counted(sql`${s.subcategory}`, wanted.subcategories))) return undefined;
  if (!(await counted(sql`${s.incomeSource}`, wanted.incomeSources))) return undefined;
  // A subcategory is live only while its category is too (DESIGN.md §7.1).
  const archivedSubcategories =
    wanted.subcategories.length === 0
      ? []
      : (
          await dbAll<{ id: string }>(
            tx,
            sql`SELECT u.id AS id FROM ${s.subcategory} u JOIN ${s.category} c ON c.id = u.category_id AND c.book_id = u.book_id
                 WHERE u.book_id = ${bookId} AND u.id IN (${list(wanted.subcategories)})
                   AND (u.archived_at IS NOT NULL OR c.archived_at IS NOT NULL)`,
          )
        ).map((row) => row.id);
  return { facts, archivedSubcategories };
}

/** What can be said of the input alone, before anything is written: the first refusal is the answer. */
function checkInput(input: TxnInput): Extract<WriteResult, { ok: false }> | undefined {
  const problems = checkShape(input);
  return problems.length > 0 ? { ok: false, reason: 'invalid', problems } : undefined;
}

/**
 * What needs the accounts the lines name, **after the entry's own row has been written under the permission**: that every target is the book's, and that the
 * accounts are what the lines say. A refusal rolls the row back with the rest, so nothing is left of it.
 */
async function checkTargets(
  tx: Database,
  accountId: string,
  bookId: string,
  input: TxnInput,
  /** Subcategories the entry already has, which stay allowed when archived: changing a note of an old entry is not a reason to refuse it. */
  alreadyOn: ReadonlySet<string> = new Set(),
): Promise<void> {
  const found = await resolve(tx, accountId, bookId, input.lines);
  if (found === undefined) throw new Refused(NOT_FOUND);
  const problems = checkAccounts(input, found.facts);
  if (found.archivedSubcategories.some((id) => !alreadyOn.has(id)))
    problems.push('A subcategory is archived: choose one that is not.');
  if (problems.length > 0) throw new Refused({ ok: false, reason: 'invalid', problems });
}

/**
 * The statement for one line: it inserts only if the entry is in the book **and is the account's to write to**, and only if what the line points at is in that
 * same book. No row is written otherwise, and the caller reads the empty answer as not found.
 */
function lineStatement(
  tx: Database,
  accountId: string,
  bookId: string,
  txnId: string,
  line: LineInput,
  position: number,
): SQL {
  const s = schema(tx);
  const kind = targetOf(line);
  const id = crypto.randomUUID();
  const pointed = (table: SQL, targetId: string) =>
    sql`EXISTS (SELECT 1 FROM ${table} p WHERE p.id = ${targetId} AND p.book_id = t.book_id)`;
  let column: SQL;
  let value: SQL;
  let exists: SQL;
  switch (kind) {
    case 'account':
      column = sql.raw('account_id');
      value = sql`${line.account}`;
      exists = pointed(sql`${s.moneyAccount}`, line.account as string);
      break;
    case 'subcategory':
      column = sql.raw('subcategory_id');
      value = sql`${line.subcategory}`;
      exists = pointed(sql`${s.subcategory}`, line.subcategory as string);
      break;
    case 'income_source':
      column = sql.raw('income_source_id');
      value = sql`${line.incomeSource}`;
      exists = pointed(sql`${s.incomeSource}`, line.incomeSource as string);
      break;
    default:
      column = sql.raw('equity');
      value = sql`${line.equity}`;
      exists = sql`1 = 1`;
  }
  return sql`INSERT INTO ${s.txnLine} (id, book_id, txn_id, ${column}, amount, currency, position)
             SELECT ${id}, t.book_id, t.id, ${value}, ${line.amount}, ${line.currency}, ${position}
               FROM ${s.txn} t
              WHERE t.id = ${txnId} AND t.book_id = ${bookId} AND ${inBook(tx, sql`t.book_id`, accountId)}
                AND ${exists}
             RETURNING id`;
}

async function writeLines(
  tx: Database,
  accountId: string,
  bookId: string,
  txnId: string,
  lines: readonly LineInput[],
): Promise<void> {
  for (const [position, line] of lines.entries()) {
    const written = await dbAll<{ id: string }>(
      tx,
      lineStatement(tx, accountId, bookId, txnId, line, position),
    );
    if (written.length === 0) throw new Refused(NOT_FOUND);
  }
}

/**
 * Sets the entry's payee from its name and remembers what was used with it: the payee is found, or made if the name is new, in the same transaction, so a
 * refusal leaves no payee behind. `undefined` keeps what the entry has (`keep`), `null` or an empty name removes it.
 */
async function setPayee(
  tx: Database,
  accountId: string,
  bookId: string,
  txnId: string,
  input: TxnInput,
  now: number,
  keep: boolean,
): Promise<void> {
  const s = schema(tx);
  if (input.payee === undefined && keep) return;
  const name = input.payee?.trim();
  if (!name) {
    await dbAll(
      tx,
      sql`UPDATE ${s.txn} SET payee_id = NULL WHERE id = ${txnId} AND book_id = ${bookId} RETURNING id`,
    );
    return;
  }
  const payeeId = await resolvePayee(tx, accountId, bookId, name, now);
  if (payeeId === undefined) throw new Refused(NOT_FOUND);
  await dbAll(
    tx,
    sql`UPDATE ${s.txn} SET payee_id = ${payeeId} WHERE id = ${txnId} AND book_id = ${bookId} RETURNING id`,
  );
  await rememberPayee(tx, bookId, payeeId, {
    ...(input.lines.find((line) => line.subcategory !== undefined)?.subcategory
      ? {
          subcategoryId: input.lines.find((line) => line.subcategory !== undefined)
            ?.subcategory as string,
        }
      : {}),
    ...(input.lines.find((line) => line.account !== undefined)?.account
      ? { accountId: input.lines.find((line) => line.account !== undefined)?.account as string }
      : {}),
  });
}

const noteOf = (note: string | null | undefined): string | null => {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Runs `work` as one transaction and turns a refusal inside it into the answer, after it has been rolled back. `work` is for writes that are one thing with
 * a transaction (an account and its opening balance, 4.1): it uses `insertTransaction` below on the handle it is given.
 */
export async function runWrite(
  database: Database,
  work: (tx: Database) => Promise<string>,
): Promise<WriteResult> {
  try {
    return { ok: true, id: await transaction(database, work) };
  } catch (error) {
    if (error instanceof Refused) return error.result;
    throw error;
  }
}

/**
 * Writes an entry and its lines **on a handle that is already in a transaction**, for a write that is one thing with something else (an account and its
 * opening balance). Throws a refusal that `runWrite` turns into the answer; nothing here catches it, so the caller's transaction rolls back with it.
 */
export async function insertTransaction(
  tx: Database,
  accountId: string,
  bookId: string,
  input: TxnInput,
  now: number,
): Promise<string> {
  const refused = checkInput(input);
  if (refused) throw new Refused(refused);
  const s = schema(tx);
  const id = crypto.randomUUID();
  const inserted = await dbAll<{ id: string }>(
    tx,
    sql`INSERT INTO ${s.txn} (id, book_id, type, date, note, status, original_amount, original_currency, created_by, created_at, updated_at)
        SELECT ${id}, b.id, ${input.type}, ${input.date}, ${noteOf(input.note)}, ${input.status ?? defaultStatus(input.type)},
               ${input.original?.amount ?? null}, ${input.original?.currency ?? null}, ${accountId}, ${now}, ${now}
          FROM ${bookTable(tx)} b
         WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}
        RETURNING id`,
  );
  if (inserted.length === 0) throw new Refused(NOT_FOUND);
  await checkTargets(tx, accountId, bookId, input);
  await writeLines(tx, accountId, bookId, id, input.lines);
  await setPayee(tx, accountId, bookId, id, input, now, false);
  return id;
}

/** Writes a new transaction in the account's book, with its lines, or says why not. `now` is given so that a test needs no clock. */
export async function createTransaction(
  database: Database,
  accountId: string,
  bookId: string,
  input: TxnInput,
  now: number = Date.now(),
): Promise<WriteResult> {
  const refused = checkInput(input);
  if (refused) return refused;
  return runWrite(database, (tx) => insertTransaction(tx, accountId, bookId, input, now));
}

/** What a refusal inside `runWrite` is made of, for a module that writes more than a transaction in one. */
export function refusal(result: Extract<WriteResult, { ok: false }>): Error {
  return new Refused(result);
}

/**
 * Replaces an entry: its own row and its lines, **in one transaction**, so that an entry is never seen with the lines of the old and the new together or with
 * none. A status not given is kept; who made it and when are kept. An entry that is not the account's is not found.
 */
export async function updateTransaction(
  database: Database,
  accountId: string,
  bookId: string,
  txnId: string,
  input: TxnInput,
  now: number = Date.now(),
): Promise<WriteResult> {
  const refused = checkInput(input);
  if (refused) return refused;
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const updated = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.txn}
             SET type = ${input.type}, date = ${input.date}, note = ${noteOf(input.note)},
                 status = ${input.status ?? sql`status`},
                 original_amount = ${input.original?.amount ?? null}, original_currency = ${input.original?.currency ?? null},
                 updated_at = ${now}
           WHERE id = ${txnId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.txn.bookId}`, accountId)}
          RETURNING id`,
    );
    if (updated.length === 0) throw new Refused(NOT_FOUND);
    const existing = await dbAll<{ id: string }>(
      tx,
      sql`SELECT l.subcategory_id AS id FROM ${s.txnLine} l
           WHERE l.txn_id = ${txnId} AND l.book_id = ${bookId} AND l.subcategory_id IS NOT NULL`,
    );
    await checkTargets(tx, accountId, bookId, input, new Set(existing.map((row) => row.id)));
    await dbAll(
      tx,
      sql`DELETE FROM ${s.txnLine} WHERE txn_id = ${txnId} AND book_id = ${bookId} RETURNING id`,
    );
    await writeLines(tx, accountId, bookId, txnId, input.lines);
    await setPayee(tx, accountId, bookId, txnId, input, now, true);
    return txnId;
  });
}

/** Deletes an entry and its lines in one transaction. `true` if it was the account's and is gone; `false` if there was no such entry for them. Safe to repeat. */
export async function deleteTransaction(
  database: Database,
  accountId: string,
  bookId: string,
  txnId: string,
): Promise<boolean> {
  return transaction(database, async (tx) => {
    const s = schema(tx);
    const gone = await dbAll<{ id: string }>(
      tx,
      sql`DELETE FROM ${s.txn}
           WHERE id = ${txnId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.txn.bookId}`, accountId)}
          RETURNING id`,
    );
    if (gone.length === 0) return false;
    await dbAll(
      tx,
      sql`DELETE FROM ${s.txnLine} WHERE txn_id = ${txnId} AND book_id = ${bookId} RETURNING id`,
    );
    return true;
  });
}
