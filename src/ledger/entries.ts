import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import type { Equity, LineInput, TxnStatus, TxnType } from './validate';

/**
 * Reading one entry back (DESIGN.md §6.2), for the dialog that edits it, and the options that dialog offers (§14.4). Every statement carries the permission
 * (`inBook`): another person's entry is `undefined`, as one that never was, and what the dialog offers is the account's own book's and nothing else.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export interface EntryRow {
  readonly id: string;
  readonly type: TxnType;
  readonly date: string;
  readonly note: string | null;
  readonly payee: { readonly id: string; readonly name: string } | null;
  readonly status: TxnStatus;
  readonly original: { amount: number; currency: string } | null;
  readonly lines: readonly LineInput[];
}

/** One entry with its lines in order, or `undefined` for one that is not the account's. */
export async function getEntry(
  database: Database,
  accountId: string,
  bookId: string,
  txnId: string,
): Promise<EntryRow | undefined> {
  const s = schema(database);
  const head = await dbGet<{
    id: string;
    type: string;
    date: string;
    note: string | null;
    status: string;
    originalAmount: number | string | null;
    originalCurrency: string | null;
    payeeId: string | null;
    payeeName: string | null;
  }>(
    database,
    sql`SELECT t.id AS id, t.type AS type, t.date AS date, t.note AS note, t.status AS status,
               t.original_amount AS "originalAmount", t.original_currency AS "originalCurrency",
               p.id AS "payeeId", p.name AS "payeeName"
          FROM ${s.txn} t
          LEFT JOIN ${s.payee} p ON p.id = t.payee_id AND p.book_id = t.book_id
         WHERE t.id = ${txnId} AND t.book_id = ${bookId} AND ${inBook(database, sql`t.book_id`, accountId)}`,
  );
  if (!head) return undefined;
  const lines = await dbAll<{
    account: string | null;
    subcategory: string | null;
    incomeSource: string | null;
    equity: string | null;
    amount: number | string;
    currency: string;
  }>(
    database,
    sql`SELECT l.account_id AS account, l.subcategory_id AS subcategory, l.income_source_id AS "incomeSource", l.equity AS equity,
               l.amount AS amount, l.currency AS currency
          FROM ${s.txnLine} l
         WHERE l.txn_id = ${txnId} AND l.book_id = ${bookId} AND ${inBook(database, sql`l.book_id`, accountId)}
         ORDER BY l.position`,
  );
  return {
    id: head.id,
    type: head.type as TxnType,
    date: head.date,
    note: head.note,
    payee: head.payeeId && head.payeeName ? { id: head.payeeId, name: head.payeeName } : null,
    status: head.status as TxnStatus,
    original:
      head.originalAmount === null || head.originalCurrency === null
        ? null
        : { amount: Number(head.originalAmount), currency: head.originalCurrency },
    lines: lines.map((line) => ({
      ...(line.account === null ? {} : { account: line.account }),
      ...(line.subcategory === null ? {} : { subcategory: line.subcategory }),
      ...(line.incomeSource === null ? {} : { incomeSource: line.incomeSource }),
      ...(line.equity === null ? {} : { equity: line.equity as Equity }),
      amount: Number(line.amount),
      currency: line.currency,
    })),
  };
}

export interface EntryOptions {
  /** Today on the book's own clock, which the form starts at. */
  readonly today: string;
  readonly baseCurrency: string | null;
  /** The accounts an expense or an income may be on: live, and of a kind that holds money or credit. */
  readonly accounts: readonly { id: string; name: string; type: string; currency: string }[];
  readonly categories: readonly {
    id: string;
    name: string;
    currency: string;
    subcategories: readonly { id: string; name: string }[];
  }[];
  readonly incomeSources: readonly { id: string; name: string; currency: string }[];
}

/** The kinds of account an entry of the add dialog is on. A loan, an investment and a property are changed by their own entries, and a person's account by transfers (4.6). */
export const ENTRY_ACCOUNT_TYPES = ['bank', 'cash', 'savings', 'deposit', 'credit_card'] as const;

/** What the add dialog offers, in the order the person has put them: live accounts, live categories with their live subcategories, live income sources. */
export async function loadEntryOptions(
  database: Database,
  accountId: string,
  book: { id: string; baseCurrency: string | null },
  today: string,
): Promise<EntryOptions> {
  const s = schema(database);
  const member = (alias: string) => inBook(database, sql.raw(`${alias}.book_id`), accountId);
  const accounts = await dbAll<{ id: string; name: string; type: string; currency: string }>(
    database,
    sql`SELECT a.id AS id, a.name AS name, a.type AS type, a.currency AS currency FROM ${s.moneyAccount} a
         WHERE a.book_id = ${book.id} AND ${member('a')} AND a.archived_at IS NULL
           AND a.type IN (${sql.join(
             ENTRY_ACCOUNT_TYPES.map((type) => sql`${type}`),
             sql`, `,
           )})
         ORDER BY a.position, a.created_at, a.id`,
  );
  const categories = await dbAll<{ id: string; name: string; currency: string }>(
    database,
    sql`SELECT c.id AS id, c.name AS name, c.currency AS currency FROM ${s.category} c
         WHERE c.book_id = ${book.id} AND ${member('c')} AND c.archived_at IS NULL
         ORDER BY c.position, c.created_at, c.id`,
  );
  const subs = await dbAll<{ id: string; name: string; categoryId: string }>(
    database,
    sql`SELECT u.id AS id, u.name AS name, u.category_id AS "categoryId" FROM ${s.subcategory} u
         WHERE u.book_id = ${book.id} AND ${member('u')} AND u.archived_at IS NULL
         ORDER BY u.position, u.created_at, u.id`,
  );
  const sources = await dbAll<{ id: string; name: string; currency: string }>(
    database,
    sql`SELECT i.id AS id, i.name AS name, i.currency AS currency FROM ${s.incomeSource} i
         WHERE i.book_id = ${book.id} AND ${member('i')} AND i.archived_at IS NULL
         ORDER BY i.kind, i.created_at, i.id`,
  );
  return {
    today,
    baseCurrency: book.baseCurrency,
    accounts,
    categories: categories.map((category) => ({
      ...category,
      subcategories: subs
        .filter((sub) => sub.categoryId === category.id)
        .map(({ id, name }) => ({ id, name })),
    })),
    incomeSources: sources,
  };
}
