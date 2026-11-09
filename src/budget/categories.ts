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
 * Categories and subcategories (DESIGN.md §7.1): a category groups subcategories and has the currency its budget is kept in; expenses are labelled with
 * subcategories. **Every statement carries the permission** (`inBook`), a subcategory is made only in a category of the same book in the statement that
 * writes it, and one that has been used **cannot be deleted, only archived**: it stays in past months. Names are unique among their siblings, in a sentence
 * when they are not. Archiving a category takes its subcategories out of the pickers with it and changes none of their rows.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;
export const MAX_CATEGORY_NAME = 60;

export interface SubcategoryRow {
  readonly id: string;
  readonly name: string;
  readonly budgetSource: 'manual' | 'bills';
  readonly position: number;
  readonly archivedAt: number | null;
  /** Whether it has lines (or is a loan's interest): then it can be archived and not deleted. */
  readonly used: boolean;
}

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly position: number;
  readonly archivedAt: number | null;
  readonly subcategories: readonly SubcategoryRow[];
  /** Whether it may be deleted: none of its subcategories has been used. */
  readonly deletable: boolean;
}

/** A name that may be written, trimmed, or the sentence that says why not. */
export function checkName(name: unknown, what: 'category' | 'subcategory'): string | undefined {
  if (typeof name !== 'string' || name.trim() === '') return `A ${what} needs a name.`;
  if (name.trim().length > MAX_CATEGORY_NAME)
    return `A ${what}'s name is at most ${MAX_CATEGORY_NAME} characters.`;
  return undefined;
}

const invalid = (...problems: string[]): Extract<WriteResult, { ok: false }> => ({
  ok: false,
  reason: 'invalid',
  problems,
});

interface RawCategory {
  id: string;
  name: string;
  currency: string;
  position: number | string;
  archivedAt: number | string | null;
}
interface RawSub {
  id: string;
  categoryId: string;
  name: string;
  budgetSource: string;
  position: number | string;
  archivedAt: number | string | null;
  lines: number | string;
  loans: number | string;
}

/** The categories of the account's book with their subcategories, in order; live and archived, each marked. Empty for a book that is not theirs. */
export async function listCategories(
  database: Database,
  accountId: string,
  bookId: string,
): Promise<CategoryRow[]> {
  const s = schema(database);
  const categories = await dbAll<RawCategory>(
    database,
    sql`SELECT c.id AS id, c.name AS name, c.currency AS currency, c.position AS position, c.archived_at AS "archivedAt"
          FROM ${s.category} c
         WHERE c.book_id = ${bookId} AND ${inBook(database, sql`c.book_id`, accountId)}
         ORDER BY c.position, c.created_at, c.id`,
  );
  if (categories.length === 0) return [];
  const subs = await dbAll<RawSub>(
    database,
    sql`SELECT u.id AS id, u.category_id AS "categoryId", u.name AS name, u.budget_source AS "budgetSource", u.position AS position,
               u.archived_at AS "archivedAt",
               (SELECT COUNT(*) FROM ${s.txnLine} l WHERE l.subcategory_id = u.id AND l.book_id = u.book_id) AS lines,
               (SELECT COUNT(*) FROM ${s.loan} n WHERE n.interest_subcategory_id = u.id AND n.book_id = u.book_id) AS loans
          FROM ${s.subcategory} u
         WHERE u.book_id = ${bookId} AND ${inBook(database, sql`u.book_id`, accountId)}
         ORDER BY u.position, u.created_at, u.id`,
  );
  return categories.map((category) => {
    const own = subs
      .filter((sub) => sub.categoryId === category.id)
      .map((sub): SubcategoryRow => ({
        id: sub.id,
        name: sub.name,
        budgetSource: sub.budgetSource === 'bills' ? 'bills' : 'manual',
        position: Number(sub.position),
        archivedAt: sub.archivedAt === null ? null : Number(sub.archivedAt),
        used: Number(sub.lines) + Number(sub.loans) > 0,
      }));
    return {
      id: category.id,
      name: category.name,
      currency: category.currency,
      position: Number(category.position),
      archivedAt: category.archivedAt === null ? null : Number(category.archivedAt),
      subcategories: own,
      deletable: own.every((sub) => !sub.used),
    };
  });
}

/**
 * Makes a category. Its currency is the base currency unless one is given (a book with no base currency yet must give one); the currency is added to the
 * book's currencies, the ones the rates are fetched for. Refused, in a sentence, for a name already taken in the book.
 */
export async function createCategory(
  database: Database,
  accountId: string,
  bookId: string,
  input: { name: string; currency?: string | null },
  now: number = Date.now(),
): Promise<WriteResult> {
  const problem = checkName(input.name, 'category');
  if (problem) return invalid(problem);
  if (input.currency != null && !isSupportedCurrencyCode(input.currency))
    return invalid('The currency is not one.');
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const book = await dbGet<{ base: string | null }>(
      tx,
      sql`SELECT b.base_currency AS base FROM ${bookTable(tx)} b WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}`,
    );
    if (!book) throw refusal(NOT_FOUND);
    const currency = input.currency ?? book.base;
    if (!currency) throw refusal(invalid('Choose a currency: the book has no base currency yet.'));
    const id = crypto.randomUUID();
    const name = input.name.trim();
    const inserted = await dbAll<{ id: string }>(
      tx,
      sql`INSERT INTO ${s.category} (id, book_id, name, currency, position, created_at)
          SELECT ${id}, b.id, ${name}, ${currency},
                 (SELECT COALESCE(MAX(c.position), -1) + 1 FROM ${s.category} c WHERE c.book_id = b.id), ${now}
            FROM ${bookTable(tx)} b
           WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.category} d WHERE d.book_id = b.id AND lower(d.name) = lower(${name}))
          RETURNING id`,
    );
    if (inserted.length === 0)
      throw refusal(invalid('There is already a category with that name.'));
    await dbAll(
      tx,
      sql`INSERT INTO ${s.bookCurrency} (book_id, code, created_at) VALUES (${bookId}, ${currency}, ${now})
          ON CONFLICT (book_id, code) DO NOTHING RETURNING code`,
    );
    return id;
  });
}

/** Makes a subcategory in a category of the account's book, at the end. A category that is not theirs is not found; a name already in the category is a sentence. */
export async function createSubcategory(
  database: Database,
  accountId: string,
  bookId: string,
  categoryId: string,
  input: { name: string },
  now: number = Date.now(),
): Promise<WriteResult> {
  const problem = checkName(input.name, 'subcategory');
  if (problem) return invalid(problem);
  const name = input.name.trim();
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const id = crypto.randomUUID();
    const there = await dbGet<{ id: string }>(
      tx,
      sql`SELECT c.id AS id FROM ${s.category} c WHERE c.id = ${categoryId} AND c.book_id = ${bookId} AND ${inBook(tx, sql`c.book_id`, accountId)}`,
    );
    if (!there) throw refusal(NOT_FOUND);
    const inserted = await dbAll<{ id: string }>(
      tx,
      sql`INSERT INTO ${s.subcategory} (id, book_id, category_id, name, budget_source, position, created_at)
          SELECT ${id}, c.book_id, c.id, ${name}, 'manual',
                 (SELECT COALESCE(MAX(u.position), -1) + 1 FROM ${s.subcategory} u WHERE u.category_id = c.id AND u.book_id = c.book_id), ${now}
            FROM ${s.category} c
           WHERE c.id = ${categoryId} AND c.book_id = ${bookId} AND ${inBook(tx, sql`c.book_id`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.subcategory} d WHERE d.category_id = c.id AND d.book_id = c.book_id AND lower(d.name) = lower(${name}))
          RETURNING id`,
    );
    if (inserted.length === 0)
      throw refusal(invalid('There is already a subcategory with that name in this category.'));
    return id;
  });
}

/** Renames a category. `true` when it is theirs and renamed; a name already taken is a sentence; one that is not theirs is not found. */
export async function renameCategory(
  database: Database,
  accountId: string,
  bookId: string,
  categoryId: string,
  name: string,
): Promise<WriteResult> {
  const problem = checkName(name, 'category');
  if (problem) return invalid(problem);
  const trimmed = name.trim();
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const updated = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.category} SET name = ${trimmed}
           WHERE id = ${categoryId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.category.bookId}`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.category} d WHERE d.book_id = ${bookId} AND d.id <> ${categoryId} AND lower(d.name) = lower(${trimmed}))
          RETURNING id`,
    );
    if (updated.length > 0) return categoryId;
    const there = await dbGet<{ id: string }>(
      tx,
      sql`SELECT c.id AS id FROM ${s.category} c WHERE c.id = ${categoryId} AND c.book_id = ${bookId} AND ${inBook(tx, sql`c.book_id`, accountId)}`,
    );
    throw refusal(there ? invalid('There is already a category with that name.') : NOT_FOUND);
  });
}

/** Renames a subcategory, as `renameCategory` does a category. */
export async function renameSubcategory(
  database: Database,
  accountId: string,
  bookId: string,
  subcategoryId: string,
  name: string,
): Promise<WriteResult> {
  const problem = checkName(name, 'subcategory');
  if (problem) return invalid(problem);
  const trimmed = name.trim();
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const updated = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.subcategory} SET name = ${trimmed}
           WHERE id = ${subcategoryId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.subcategory.bookId}`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.subcategory} d WHERE d.book_id = ${bookId} AND d.id <> ${subcategoryId}
                               AND d.category_id = ${s.subcategory.categoryId} AND lower(d.name) = lower(${trimmed}))
          RETURNING id`,
    );
    if (updated.length > 0) return subcategoryId;
    const there = await dbGet<{ id: string }>(
      tx,
      sql`SELECT u.id AS id FROM ${s.subcategory} u WHERE u.id = ${subcategoryId} AND u.book_id = ${bookId} AND ${inBook(tx, sql`u.book_id`, accountId)}`,
    );
    throw refusal(
      there
        ? invalid('There is already a subcategory with that name in this category.')
        : NOT_FOUND,
    );
  });
}

/**
 * Puts the categories in the order given. Every id must be a category of the account's book and there must be no repeat, else nothing changes and it is
 * not found (an id that is another person's reads as one that is not there). Categories not named keep their place after the named ones.
 */
export async function reorderCategories(
  database: Database,
  accountId: string,
  bookId: string,
  ids: readonly string[],
): Promise<boolean> {
  if (new Set(ids).size !== ids.length) return false;
  return transaction(database, async (tx) => {
    const s = schema(tx);
    for (const [position, id] of ids.entries()) {
      const rows = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${s.category} SET position = ${position}
             WHERE id = ${id} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.category.bookId}`, accountId)} RETURNING id`,
      );
      if (rows.length === 0) throw new Error('rollback');
    }
    return true;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'rollback') return false;
    throw error;
  });
}

/** Puts a category's subcategories in the order given, as `reorderCategories` does categories; each must be in that category. */
export async function reorderSubcategories(
  database: Database,
  accountId: string,
  bookId: string,
  categoryId: string,
  ids: readonly string[],
): Promise<boolean> {
  if (new Set(ids).size !== ids.length) return false;
  return transaction(database, async (tx) => {
    const s = schema(tx);
    for (const [position, id] of ids.entries()) {
      const rows = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${s.subcategory} SET position = ${position}
             WHERE id = ${id} AND category_id = ${categoryId} AND book_id = ${bookId}
               AND ${inBook(tx, sql`${s.subcategory.bookId}`, accountId)} RETURNING id`,
      );
      if (rows.length === 0) throw new Error('rollback');
    }
    return true;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'rollback') return false;
    throw error;
  });
}

/** Archives a category or a subcategory, or brings it back: out of the pickers, still in past months. `false` for one that is not theirs. Repeating changes nothing. */
export async function setCategoryArchived(
  database: Database,
  accountId: string,
  bookId: string,
  kind: 'category' | 'subcategory',
  id: string,
  archived: boolean,
  now: number = Date.now(),
): Promise<boolean> {
  const s = schema(database);
  const table = kind === 'category' ? s.category : s.subcategory;
  const rows = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${table} SET archived_at = ${archived ? sql`COALESCE(archived_at, ${now})` : null}
         WHERE id = ${id} AND book_id = ${bookId} AND ${inBook(database, sql`${table.bookId}`, accountId)} RETURNING id`,
  );
  return rows.length > 0;
}

export type DeleteCategory = 'deleted' | 'in_use' | 'not_found';

/**
 * Deletes a subcategory **only if nothing has been spent on it** and no loan takes its interest there; `in_use` otherwise (archive it instead, and it stays in
 * past months). The delete statement carries the condition, so a line written between a look and the delete cannot be orphaned.
 */
export async function deleteSubcategory(
  database: Database,
  accountId: string,
  bookId: string,
  subcategoryId: string,
): Promise<DeleteCategory> {
  return transaction(database, async (tx) => {
    const s = schema(tx);
    const gone = await dbAll<{ id: string }>(
      tx,
      sql`DELETE FROM ${s.subcategory}
           WHERE id = ${subcategoryId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.subcategory.bookId}`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.txnLine} l WHERE l.subcategory_id = ${subcategoryId} AND l.book_id = ${bookId})
             AND NOT EXISTS (SELECT 1 FROM ${s.loan} n WHERE n.interest_subcategory_id = ${subcategoryId} AND n.book_id = ${bookId})
          RETURNING id`,
    );
    if (gone.length > 0) return 'deleted';
    const there = await dbGet<{ id: string }>(
      tx,
      sql`SELECT u.id AS id FROM ${s.subcategory} u WHERE u.id = ${subcategoryId} AND u.book_id = ${bookId} AND ${inBook(tx, sql`u.book_id`, accountId)}`,
    );
    return there ? 'in_use' : 'not_found';
  });
}

/** Deletes a category with its subcategories **only if none of them has been used**; `in_use` otherwise. One transaction: the subcategories go, then the category. */
export async function deleteCategory(
  database: Database,
  accountId: string,
  bookId: string,
  categoryId: string,
): Promise<DeleteCategory> {
  return transaction(database, async (tx) => {
    const s = schema(tx);
    const there = await dbGet<{ id: string }>(
      tx,
      sql`SELECT c.id AS id FROM ${s.category} c WHERE c.id = ${categoryId} AND c.book_id = ${bookId} AND ${inBook(tx, sql`c.book_id`, accountId)}`,
    );
    if (!there) return 'not_found';
    const used = await dbGet<{ n: number | string }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${s.subcategory} u
           WHERE u.category_id = ${categoryId} AND u.book_id = ${bookId}
             AND (EXISTS (SELECT 1 FROM ${s.txnLine} l WHERE l.subcategory_id = u.id AND l.book_id = u.book_id)
               OR EXISTS (SELECT 1 FROM ${s.loan} n WHERE n.interest_subcategory_id = u.id AND n.book_id = u.book_id))`,
    );
    if (Number(used?.n) > 0) return 'in_use';
    await dbAll(
      tx,
      sql`DELETE FROM ${s.subcategory} WHERE category_id = ${categoryId} AND book_id = ${bookId} RETURNING id`,
    );
    await dbAll(
      tx,
      sql`DELETE FROM ${s.category} WHERE id = ${categoryId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.category.bookId}`, accountId)} RETURNING id`,
    );
    return 'deleted';
  });
}
