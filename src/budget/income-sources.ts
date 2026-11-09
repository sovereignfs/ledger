import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { bookTable } from '../ledger/books';
import { refusal, runWrite, type WriteResult } from '../ledger/transactions';
import { isSupportedCurrencyCode } from '../money/currencies';

/**
 * Income sources (DESIGN.md §7.4): where income comes from, **one primary and any number of secondary**, each in one currency, each with a budgeted amount by
 * month (`amounts.ts`). An income entry names a source. **The primary one cannot be deleted or archived** (make another primary first, which makes this one a
 * secondary in the same transaction), and a source that income has been received from cannot be deleted, only archived. Every statement carries the
 * permission (`inBook`); names are unique among a book's sources, in any case, with a sentence.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;
export const MAX_SOURCE_NAME = 60;
export const SOURCE_KINDS = ['primary', 'secondary'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface IncomeSourceRow {
  readonly id: string;
  readonly name: string;
  readonly kind: SourceKind;
  readonly currency: string;
  readonly archivedAt: number | null;
  /** How many entries name it: income has been received from it, so it can be archived and not deleted. */
  readonly entries: number;
}

const invalid = (...problems: string[]): Extract<WriteResult, { ok: false }> => ({
  ok: false,
  reason: 'invalid',
  problems,
});

export function checkSourceName(name: unknown): string | undefined {
  if (typeof name !== 'string' || name.trim() === '') return 'An income source needs a name.';
  if (name.trim().length > MAX_SOURCE_NAME)
    return `An income source's name is at most ${MAX_SOURCE_NAME} characters.`;
  return undefined;
}

interface Raw {
  id: string;
  name: string;
  kind: string;
  currency: string;
  archivedAt: number | string | null;
  entries: number | string;
}

const toRow = (row: Raw): IncomeSourceRow => ({
  id: row.id,
  name: row.name,
  kind: row.kind === 'primary' ? 'primary' : 'secondary',
  currency: row.currency,
  archivedAt: row.archivedAt === null ? null : Number(row.archivedAt),
  entries: Number(row.entries),
});

/** The account's income sources, the primary first, then by name; live and archived, each marked. Empty for a book that is not theirs. */
export async function listIncomeSources(
  database: Database,
  accountId: string,
  bookId: string,
): Promise<IncomeSourceRow[]> {
  const s = schema(database);
  const rows = await dbAll<Raw>(
    database,
    sql`SELECT i.id AS id, i.name AS name, i.kind AS kind, i.currency AS currency, i.archived_at AS "archivedAt",
               (SELECT COUNT(*) FROM ${s.txnLine} l WHERE l.income_source_id = i.id AND l.book_id = i.book_id) AS entries
          FROM ${s.incomeSource} i
         WHERE i.book_id = ${bookId} AND ${inBook(database, sql`i.book_id`, accountId)}
         ORDER BY CASE WHEN i.kind = 'primary' THEN 0 ELSE 1 END, lower(i.name), i.id`,
  );
  return rows.map(toRow);
}

async function one(
  database: Database,
  accountId: string,
  bookId: string,
  id: string,
): Promise<IncomeSourceRow | undefined> {
  return (await listIncomeSources(database, accountId, bookId)).find((row) => row.id === id);
}

/**
 * Makes an income source. Its currency is the base currency unless one is given. **The first one is the primary**; after that a primary is asked for with
 * `kind: 'primary'` and refused, in a sentence, while there is one (`makePrimary` swaps them). The currency joins the book's currencies for the rates.
 */
export async function createIncomeSource(
  database: Database,
  accountId: string,
  bookId: string,
  input: { name: string; kind?: SourceKind; currency?: string | null },
  now: number = Date.now(),
): Promise<WriteResult> {
  const problem = checkSourceName(input.name);
  if (problem) return invalid(problem);
  if (input.kind !== undefined && !(SOURCE_KINDS as readonly string[]).includes(input.kind))
    return invalid('An income source is primary or secondary.');
  if (input.currency != null && !isSupportedCurrencyCode(input.currency))
    return invalid('The currency is not one.');
  const name = input.name.trim();
  const s = schema(database);
  return runWrite(database, async (tx) => {
    const book = await dbGet<{ base: string | null }>(
      tx,
      sql`SELECT b.base_currency AS base FROM ${bookTable(tx)} b WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}`,
    );
    if (!book) throw refusal(NOT_FOUND);
    const currency = input.currency ?? book.base;
    if (!currency) throw refusal(invalid('Choose a currency: the book has no base currency yet.'));
    const primaries = await dbGet<{ n: number | string }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${s.incomeSource} i WHERE i.book_id = ${bookId} AND i.kind = 'primary' AND i.archived_at IS NULL`,
    );
    const hasPrimary = Number(primaries?.n) > 0;
    const kind: SourceKind = input.kind ?? (hasPrimary ? 'secondary' : 'primary');
    if (kind === 'primary' && hasPrimary)
      throw refusal(
        invalid(
          'There is a primary income source already. Make this one primary from the list, which makes the other secondary.',
        ),
      );
    const id = crypto.randomUUID();
    const inserted = await dbAll<{ id: string }>(
      tx,
      sql`INSERT INTO ${s.incomeSource} (id, book_id, name, kind, currency, created_at)
          SELECT ${id}, b.id, ${name}, ${kind}, ${currency}, ${now}
            FROM ${bookTable(tx)} b
           WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.incomeSource} d WHERE d.book_id = b.id AND lower(d.name) = lower(${name}))
          RETURNING id`,
    );
    if (inserted.length === 0)
      throw refusal(invalid('There is already an income source with that name.'));
    await dbAll(
      tx,
      sql`INSERT INTO ${s.bookCurrency} (book_id, code, created_at) VALUES (${bookId}, ${currency}, ${now}) ON CONFLICT (book_id, code) DO NOTHING RETURNING code`,
    );
    return id;
  });
}

/** Renames a source. A name another has (any case) is a sentence; one that is not the account's is not found. */
export async function renameIncomeSource(
  database: Database,
  accountId: string,
  bookId: string,
  id: string,
  name: string,
): Promise<WriteResult> {
  const problem = checkSourceName(name);
  if (problem) return invalid(problem);
  const trimmed = name.trim();
  const s = schema(database);
  return runWrite(database, async (tx) => {
    const updated = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.incomeSource} SET name = ${trimmed}
           WHERE id = ${id} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.incomeSource.bookId}`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.incomeSource} d WHERE d.book_id = ${bookId} AND d.id <> ${id} AND lower(d.name) = lower(${trimmed}))
          RETURNING id`,
    );
    if (updated.length > 0) return id;
    throw refusal(
      (await one(tx, accountId, bookId, id))
        ? invalid('There is already an income source with that name.')
        : NOT_FOUND,
    );
  });
}

/** Makes a source the primary, and the one that was primary a secondary, **in one transaction**: there is never none or two. `false` for one that is not the account's. */
export async function makePrimary(
  database: Database,
  accountId: string,
  bookId: string,
  id: string,
): Promise<boolean> {
  const s = schema(database);
  const result = await runWrite(database, async (tx) => {
    const mine = await dbGet<{ id: string }>(
      tx,
      sql`SELECT i.id AS id FROM ${s.incomeSource} i WHERE i.id = ${id} AND i.book_id = ${bookId} AND i.archived_at IS NULL AND ${inBook(tx, sql`i.book_id`, accountId)}`,
    );
    if (!mine) throw refusal(NOT_FOUND);
    await dbAll(
      tx,
      sql`UPDATE ${s.incomeSource} SET kind = 'secondary' WHERE book_id = ${bookId} AND kind = 'primary' AND id <> ${id} RETURNING id`,
    );
    await dbAll(
      tx,
      sql`UPDATE ${s.incomeSource} SET kind = 'primary' WHERE id = ${id} AND book_id = ${bookId} RETURNING id`,
    );
    return id;
  });
  return result.ok;
}

export type ArchiveSource = 'done' | 'primary' | 'not_found';

/** Archives a source or brings it back. **The primary is not archived**: make another primary first. */
export async function setIncomeSourceArchived(
  database: Database,
  accountId: string,
  bookId: string,
  id: string,
  archived: boolean,
  now: number = Date.now(),
): Promise<ArchiveSource> {
  const s = schema(database);
  const rows = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${s.incomeSource} SET archived_at = ${archived ? sql`COALESCE(archived_at, ${now})` : null}
         WHERE id = ${id} AND book_id = ${bookId} AND ${inBook(database, sql`${s.incomeSource.bookId}`, accountId)}
           ${archived ? sql`AND kind <> 'primary'` : sql``}
        RETURNING id`,
  );
  if (rows.length > 0) return 'done';
  const there = await one(database, accountId, bookId, id);
  return there ? 'primary' : 'not_found';
}

export type DeleteSource = 'deleted' | 'in_use' | 'primary' | 'not_found';

/**
 * Deletes a source **only if it is not the primary and no income has been received from it** (`in_use`: archive it instead). The statement carries the
 * conditions; its budgeted amounts go with it, in one transaction.
 */
export async function deleteIncomeSource(
  database: Database,
  accountId: string,
  bookId: string,
  id: string,
): Promise<DeleteSource> {
  const s = schema(database);
  return transaction(database, async (tx) => {
    const gone = await dbAll<{ id: string }>(
      tx,
      sql`DELETE FROM ${s.incomeSource}
           WHERE id = ${id} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.incomeSource.bookId}`, accountId)}
             AND kind <> 'primary'
             AND NOT EXISTS (SELECT 1 FROM ${s.txnLine} l WHERE l.income_source_id = ${id} AND l.book_id = ${bookId})
          RETURNING id`,
    );
    if (gone.length > 0) {
      await dbAll(
        tx,
        sql`DELETE FROM ${s.budgetAmount} WHERE book_id = ${bookId} AND target_kind = 'income' AND target_id = ${id} RETURNING target_id`,
      );
      return 'deleted';
    }
    const there = await one(tx, accountId, bookId, id);
    if (!there) return 'not_found';
    return there.kind === 'primary' ? 'primary' : 'in_use';
  });
}
