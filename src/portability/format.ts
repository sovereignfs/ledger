import { type Column, getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import * as sqliteSchema from '../db/schema/sqlite';
import { tableNamed } from '../db/tables';
import { findBook } from '../ledger/books';

/**
 * A book in one file (DESIGN.md §16): **format `ledger`, version 1**. The file holds the book's settings and **every row of every table that carries `book_id`**, as the
 * database holds it but for what is the database's own: `book_id` is the file's (a book is one file), and the person who made or reviewed a row is not named (it is
 * whoever imports it). Ids are kept, so that the rows that point at each other still do, and are made again on import (`import.ts`). **Not the rates** (public) and **not
 * sign-in data**. Which table has which ids, and what points at what, is `TABLES` below and nothing else: a table in `BOOK_TABLES` that is not in it fails
 * `format.test.ts`, so a new table cannot be added and left out of the file, as one cannot be left out of the person's deletion.
 */
export const FORMAT = 'ledger';
export const VERSION = 1;

export interface TableSpec {
  readonly table: string;
  /** The column that is this row's own id, which import makes again. A table keyed by what it points at (a loan by its account) has none. */
  readonly id?: string;
  /** Columns that hold another table's id, by the table they point at. */
  readonly refs: Readonly<Record<string, string>>;
  /** A column that points at a table named by another column of the same row (`budget_amount`'s target by its kind). */
  readonly poly?: {
    readonly column: string;
    readonly kind: string;
    readonly targets: Readonly<Record<string, string>>;
  };
  /** Columns that name the person who made or reviewed the row: left out of the file, and the importer's on import. */
  readonly person?: readonly string[];
  /** A column holding JSON whose lines point at accounts, subcategories and income sources (`recurring`'s template). */
  readonly template?: string;
  /** What the rows are ordered by in the file: nothing that is an id, so that two exports of the same book list the same rows in the same order. */
  readonly order: readonly string[];
}

/**
 * The tables, **parents before the children that point at them**, which is the order import writes them in. `book_id` is every table's and is not listed. A column that is
 * neither an id, a reference, a person nor the book's is a plain value, exported as it is.
 */
export const TABLES: readonly TableSpec[] = [
  {
    table: 'money_account',
    id: 'id',
    refs: {},
    order: ['position', 'created_at', 'name', 'type', 'currency'],
  },
  { table: 'category', id: 'id', refs: {}, order: ['position', 'created_at', 'name'] },
  {
    table: 'subcategory',
    id: 'id',
    refs: { category_id: 'category' },
    order: ['position', 'created_at', 'name'],
  },
  { table: 'income_source', id: 'id', refs: {}, order: ['created_at', 'kind', 'name'] },
  {
    table: 'jar',
    id: 'id',
    refs: { account_id: 'money_account' },
    order: ['position', 'created_at', 'name'],
  },
  {
    table: 'payee',
    id: 'id',
    refs: { last_subcategory_id: 'subcategory', last_account_id: 'money_account' },
    order: ['created_at', 'name_key'],
  },
  {
    table: 'recurring',
    id: 'id',
    refs: { loan_account_id: 'money_account' },
    template: 'template',
    order: ['created_at', 'anchor_date', 'unit', 'every', 'mode'],
  },
  {
    table: 'txn',
    id: 'id',
    refs: { payee_id: 'payee', recurring_id: 'recurring' },
    person: ['created_by'],
    order: ['date', 'created_at', 'type', 'status', 'occurrence_date'],
  },
  {
    table: 'txn_line',
    id: 'id',
    refs: {
      txn_id: 'txn',
      account_id: 'money_account',
      subcategory_id: 'subcategory',
      income_source_id: 'income_source',
    },
    order: ['position', 'amount', 'currency'],
  },
  {
    table: 'loan',
    refs: { account_id: 'money_account', interest_subcategory_id: 'subcategory' },
    order: ['start_date', 'lender'],
  },
  {
    table: 'budget_amount',
    refs: {},
    poly: {
      column: 'target_id',
      kind: 'target_kind',
      targets: { subcategory: 'subcategory', income: 'income_source', jar: 'jar' },
    },
    order: ['target_kind', 'from_month', 'created_at', 'amount'],
  },
  { table: 'recurring_skip', refs: { recurring_id: 'recurring' }, order: ['occurrence_date'] },
  {
    table: 'jar_movement',
    id: 'id',
    refs: { jar_id: 'jar', txn_id: 'txn' },
    order: ['date', 'created_at', 'kind', 'amount'],
  },
  { table: 'month_review', refs: {}, person: ['reviewed_by'], order: ['month'] },
  { table: 'book_currency', refs: {}, order: ['code'] },
];

/** The book's own settings, which are in the file and are put back on import. */
export interface BookSettings {
  readonly name: string;
  readonly baseCurrency: string | null;
  readonly timeZone: string;
  readonly firstDayOfWeek: number;
  readonly locale: string | null;
  readonly recap: boolean;
  readonly setupDoneAt: number | null;
}

export type Row = Record<string, string | number | boolean | null>;

export interface ExportFile {
  readonly format: typeof FORMAT;
  readonly version: number;
  /** When the file was made, in milliseconds since the epoch. */
  readonly exportedAt: number;
  readonly book: BookSettings;
  readonly tables: Readonly<Record<string, readonly Row[]>>;
}

/** The columns of a table, in the database's own names. */
export function columnsOf(database: Database, table: string): Column[] {
  return Object.values(getTableColumns(tableNamed(database, table) as never)) as Column[];
}

/**
 * The columns of a table **as the format knows them**, which are the same on both dialects (the schema parity test keeps them so), read from SQLite's: for the code that reads a
 * file and has no database to ask.
 */
export function canonicalColumns(table: string): Column[] {
  for (const value of Object.values(sqliteSchema))
    if (is(value, SQLiteTable) && getTableName(value as SQLiteTable) === table)
      return Object.values(getTableColumns(value as SQLiteTable)) as Column[];
  throw new Error(`no table named ${table}`);
}

/** The columns of a table that go in the file: all but `book_id` and a person's. */
export function fileColumns(database: Database | undefined, spec: TableSpec): Column[] {
  return (database ? columnsOf(database, spec.table) : canonicalColumns(spec.table)).filter(
    (column) => column.name !== 'book_id' && !(spec.person ?? []).includes(column.name),
  );
}

/** A value as the file holds it: a number is a number (PostgreSQL gives a `bigint` as text), a flag is a flag, and nothing is nothing. */
export function plain(column: Column, value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (column.dataType === 'number') return Number(value);
  if (column.dataType === 'boolean')
    return typeof value === 'boolean' ? value : Number(value) !== 0;
  return String(value);
}

/**
 * Every row of the account's book, in one short transaction: the settings, and each table in `TABLES` ordered by what is not an id. **Nothing of another book**: every
 * statement carries the permission. `not_found` (undefined) for a book that is not the account's.
 */
export async function exportBook(
  database: Database,
  accountId: string,
  bookId: string,
  now: number = Date.now(),
): Promise<ExportFile | undefined> {
  return transaction(database, async (tx) => {
    const book = await findBook(tx, accountId);
    if (!book || book.id !== bookId) return undefined;
    const tables: Record<string, Row[]> = {};
    for (const spec of TABLES) {
      const columns = fileColumns(tx, spec);
      const table = tableNamed(tx, spec.table);
      const rows = await dbAll<Record<string, unknown>>(
        tx,
        sql`SELECT ${sql.join(
          columns.map((column) => sql.raw(`t."${column.name}" AS "${column.name}"`)),
          sql`, `,
        )}
              FROM ${table} t
             WHERE t.book_id = ${bookId} AND ${inBook(tx, sql`t.book_id`, accountId)}
             ORDER BY ${sql.join(
               [...spec.order, ...(spec.id ? [spec.id] : [])].map((name) => sql.raw(`t."${name}"`)),
               sql`, `,
             )}`,
      );
      tables[spec.table] = rows.map((row) =>
        Object.fromEntries(columns.map((column) => [column.name, plain(column, row[column.name])])),
      );
    }
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: now,
      book: {
        name: book.name,
        baseCurrency: book.baseCurrency,
        timeZone: book.timeZone,
        firstDayOfWeek: book.firstDayOfWeek,
        locale: book.locale,
        recap: book.recap,
        setupDoneAt: book.setupDoneAt,
      },
      tables,
    };
  });
}

/** The tables the file must hold, which are the book's tables and no others. */
export const FILE_TABLES: readonly string[] = TABLES.map((spec) => spec.table);
