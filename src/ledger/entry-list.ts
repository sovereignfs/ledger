import { type SQL, sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import type { Cursor, EntryFilter } from '../transactions/filter';
import { payeeKey } from './payee-write';
import type { TxnStatus, TxnType } from './validate';

/**
 * The transactions list (DESIGN.md §6.9): every entry of the book, newest first, **paged by date**, narrowed by filters that combine. Every statement carries
 * the permission (`inBook`), so another person's book lists nothing. **Text is matched as text**: what is typed is escaped, so `%` and `_` are only themselves
 * and nothing typed is a pattern or reaches the statement as anything but a bound value. With exactly one account filtered, each row also says what that
 * account's balance was right after it.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export const PAGE_SIZE = 50;

/** `%`, `_` and `\` in what is searched for are what they say, and not a pattern. */
const literal = (text: string) => text.replace(/[\\%_]/g, (mark) => `\\${mark}`);

export interface EntryLine {
  readonly account: { id: string; name: string } | null;
  readonly subcategory: { id: string; name: string; category: string } | null;
  readonly incomeSource: { id: string; name: string } | null;
  readonly equity: string | null;
  readonly amount: number;
  readonly currency: string;
}

export interface ListedEntry {
  readonly id: string;
  readonly date: string;
  readonly type: TxnType;
  readonly status: TxnStatus;
  readonly note: string | null;
  readonly payee: { id: string; name: string } | null;
  readonly createdAt: number;
  readonly lines: readonly EntryLine[];
  /** The balance of the one account filtered, right after this entry, in its currency; `null` when no one account is filtered. */
  readonly balanceAfter: number | null;
}

export interface EntryPage {
  readonly entries: readonly ListedEntry[];
  /** Where the next page of older entries starts, or `undefined` when this is the last. */
  readonly next: Cursor | undefined;
}

/** The conditions a filter and a cursor make, each a bound value. */
function conditions(database: Database, filter: EntryFilter, cursor: Cursor | undefined): SQL[] {
  const s = schema(database);
  const out: SQL[] = [];
  const hasLine = (extra: SQL) =>
    sql`EXISTS (SELECT 1 FROM ${s.txnLine} l WHERE l.txn_id = t.id AND l.book_id = t.book_id AND ${extra})`;
  if (filter.account) out.push(hasLine(sql`l.account_id = ${filter.account}`));
  if (filter.subcategory) out.push(hasLine(sql`l.subcategory_id = ${filter.subcategory}`));
  else if (filter.category)
    out.push(
      hasLine(
        sql`l.subcategory_id IN (SELECT u.id FROM ${s.subcategory} u WHERE u.category_id = ${filter.category} AND u.book_id = t.book_id)`,
      ),
    );
  if (filter.payee) out.push(sql`t.payee_id = ${filter.payee}`);
  if (filter.type) out.push(sql`t.type = ${filter.type}`);
  if (filter.status) out.push(sql`t.status = ${filter.status}`);
  if (filter.from) out.push(sql`t.date >= ${filter.from}`);
  if (filter.to) out.push(sql`t.date <= ${filter.to}`);
  if (filter.q) {
    const needle = `%${literal(payeeKey(filter.q))}%`;
    out.push(
      sql`(p.name_key LIKE ${needle} ESCAPE '\\' OR lower(COALESCE(t.note, '')) LIKE ${needle} ESCAPE '\\')`,
    );
  }
  if (cursor)
    out.push(
      sql`(t.date < ${cursor.date} OR (t.date = ${cursor.date} AND (t.created_at < ${cursor.createdAt}
            OR (t.created_at = ${cursor.createdAt} AND t.id < ${cursor.id}))))`,
    );
  return out;
}

/** One page of the account's entries, newest first, narrowed by `filter`, from `cursor` (the entry after which to start). */
export async function listEntries(
  database: Database,
  accountId: string,
  bookId: string,
  filter: EntryFilter = {},
  cursor?: Cursor,
  limit: number = PAGE_SIZE,
): Promise<EntryPage> {
  const s = schema(database);
  const size = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const where = conditions(database, filter, cursor);
  const heads = await dbAll<{
    id: string;
    date: string;
    type: string;
    status: string;
    note: string | null;
    payeeId: string | null;
    payeeName: string | null;
    createdAt: number | string;
  }>(
    database,
    sql`SELECT t.id AS id, t.date AS date, t.type AS type, t.status AS status, t.note AS note,
               p.id AS "payeeId", p.name AS "payeeName", t.created_at AS "createdAt"
          FROM ${s.txn} t
          LEFT JOIN ${s.payee} p ON p.id = t.payee_id AND p.book_id = t.book_id
         WHERE t.book_id = ${bookId} AND ${inBook(database, sql`t.book_id`, accountId)}
           ${sql.join(
             where.map((condition) => sql`AND ${condition}`),
             sql` `,
           )}
         ORDER BY t.date DESC, t.created_at DESC, t.id DESC
         LIMIT ${size + 1}`,
  );
  const page = heads.slice(0, size);
  if (page.length === 0) return { entries: [], next: undefined };
  const ids = sql.join(
    page.map((head) => sql`${head.id}`),
    sql`, `,
  );
  const lines = await dbAll<{
    txnId: string;
    accountId: string | null;
    accountName: string | null;
    subcategoryId: string | null;
    subcategoryName: string | null;
    categoryName: string | null;
    incomeSourceId: string | null;
    incomeSourceName: string | null;
    equity: string | null;
    amount: number | string;
    currency: string;
  }>(
    database,
    sql`SELECT l.txn_id AS "txnId", a.id AS "accountId", a.name AS "accountName",
               u.id AS "subcategoryId", u.name AS "subcategoryName", c.name AS "categoryName",
               i.id AS "incomeSourceId", i.name AS "incomeSourceName",
               l.equity AS equity, l.amount AS amount, l.currency AS currency
          FROM ${s.txnLine} l
          LEFT JOIN ${s.moneyAccount} a ON a.id = l.account_id AND a.book_id = l.book_id
          LEFT JOIN ${s.subcategory} u ON u.id = l.subcategory_id AND u.book_id = l.book_id
          LEFT JOIN ${s.category} c ON c.id = u.category_id AND c.book_id = u.book_id
          LEFT JOIN ${s.incomeSource} i ON i.id = l.income_source_id AND i.book_id = l.book_id
         WHERE l.book_id = ${bookId} AND ${inBook(database, sql`l.book_id`, accountId)} AND l.txn_id IN (${ids})
         ORDER BY l.txn_id, l.position`,
  );
  // With one account filtered, what its balance was right after each entry: the sum of its lines on every entry at or before this one, in the order the list
  // is in, whatever else is filtered out of view.
  let balances = new Map<string, number>();
  if (filter.account) {
    const rows = await dbAll<{ id: string; balance: number | string | null }>(
      database,
      sql`SELECT t.id AS id,
                 (SELECT SUM(x.amount) FROM ${s.txnLine} x JOIN ${s.txn} e ON e.id = x.txn_id AND e.book_id = x.book_id
                   WHERE x.account_id = ${filter.account} AND x.book_id = t.book_id
                     AND (e.date < t.date OR (e.date = t.date AND (e.created_at < t.created_at
                          OR (e.created_at = t.created_at AND e.id <= t.id))))) AS balance
            FROM ${s.txn} t
           WHERE t.book_id = ${bookId} AND ${inBook(database, sql`t.book_id`, accountId)} AND t.id IN (${ids})`,
    );
    balances = new Map(rows.map((row) => [row.id, Number(row.balance ?? 0)]));
  }
  const last = page[page.length - 1];
  return {
    entries: page.map((head) => ({
      id: head.id,
      date: head.date,
      type: head.type as TxnType,
      status: head.status as TxnStatus,
      note: head.note,
      payee: head.payeeId && head.payeeName ? { id: head.payeeId, name: head.payeeName } : null,
      createdAt: Number(head.createdAt),
      lines: lines
        .filter((line) => line.txnId === head.id)
        .map((line) => ({
          account:
            line.accountId && line.accountName
              ? { id: line.accountId, name: line.accountName }
              : null,
          subcategory:
            line.subcategoryId && line.subcategoryName
              ? {
                  id: line.subcategoryId,
                  name: line.subcategoryName,
                  category: line.categoryName ?? '',
                }
              : null,
          incomeSource:
            line.incomeSourceId && line.incomeSourceName
              ? { id: line.incomeSourceId, name: line.incomeSourceName }
              : null,
          equity: line.equity,
          amount: Number(line.amount),
          currency: line.currency,
        })),
      balanceAfter: filter.account ? (balances.get(head.id) ?? 0) : null,
    })),
    next:
      heads.length > size && last
        ? { date: last.date, createdAt: Number(last.createdAt), id: last.id }
        : undefined,
  };
}
