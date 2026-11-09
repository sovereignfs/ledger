import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { balancesOf } from './balances';
import { bookTable } from './books';
import {
  type AccountPatch,
  type AccountType,
  type LoanTerms,
  type NewAccount,
  checkNewAccount,
  checkPatch,
} from './account-types';
import { insertTransaction, refusal, runWrite, type WriteResult } from './transactions';

/**
 * Money accounts (DESIGN.md §6.1, §6.4): making one, changing it, archiving it, deleting it, and reading them with their balances. **Every statement carries
 * the permission** (`inBook`), so another person's account reads as one that is not there; **the currency and the kind of an account never change**, which
 * would re-price its history; and **making one with something in it writes an `opening` transaction** through the one path (`transactions.ts`), in the same
 * database transaction as the account, so an account never exists without the balance it was given.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;

export interface AccountRow {
  readonly id: string;
  readonly type: AccountType;
  readonly name: string;
  readonly institution: string | null;
  readonly currency: string;
  readonly creditLimit: number | null;
  readonly position: number;
  readonly archivedAt: number | null;
  /** The sum of the account's lines, in its currency's minor units: negative while money is owed (DESIGN.md §6.1). */
  readonly balance: number;
  readonly loan: LoanTerms | null;
  /** Whether it may be deleted: it has no entries but its opening balance. */
  readonly deletable: boolean;
}

interface RawAccount {
  id: string;
  type: string;
  name: string;
  institution: string | null;
  currency: string;
  creditLimit: number | string | null;
  position: number | string;
  archivedAt: number | string | null;
  lender: string | null;
  principal: number | string | null;
  startDate: string | null;
  endDate: string | null;
  instalment: number | string | null;
  yearlyRate: string | null;
  interestSubcategoryId: string | null;
  entries: number | string;
}

const num = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

/**
 * The account's accounts in a book, or one of them (`only`), with balances and loan terms. `archived` says which: `false` (the default) the live ones, `true`
 * the archived ones. `entries` counts the entries that are **not an opening balance**: an account with none can be deleted.
 */
async function read(
  database: Database,
  accountId: string,
  bookId: string,
  options: { archived?: boolean; only?: string },
): Promise<AccountRow[]> {
  const s = schema(database);
  const rows = await dbAll<RawAccount>(
    database,
    sql`SELECT a.id AS id, a.type AS type, a.name AS name, a.institution AS institution, a.currency AS currency,
               a.credit_limit AS "creditLimit", a.position AS position, a.archived_at AS "archivedAt",
               l.lender AS lender, l.principal AS principal, l.start_date AS "startDate", l.end_date AS "endDate",
               l.instalment AS instalment, l.yearly_rate AS "yearlyRate", l.interest_subcategory_id AS "interestSubcategoryId",
               (SELECT COUNT(*) FROM ${s.txnLine} x JOIN ${s.txn} t ON t.id = x.txn_id AND t.book_id = x.book_id
                 WHERE x.account_id = a.id AND x.book_id = a.book_id AND t.type <> 'opening') AS entries
          FROM ${s.moneyAccount} a
          LEFT JOIN ${s.loan} l ON l.account_id = a.id AND l.book_id = a.book_id
         WHERE a.book_id = ${bookId} AND ${inBook(database, sql`a.book_id`, accountId)}
           ${options.only === undefined ? sql`` : sql`AND a.id = ${options.only}`}
           ${options.only !== undefined ? sql`` : options.archived ? sql`AND a.archived_at IS NOT NULL` : sql`AND a.archived_at IS NULL`}
         ORDER BY a.position, a.created_at, a.id`,
  );
  if (rows.length === 0) return [];
  const balances = await balancesOf(database, accountId, bookId);
  return rows.map((row) => ({
    id: row.id,
    type: row.type as AccountType,
    name: row.name,
    institution: row.institution,
    currency: row.currency,
    creditLimit: num(row.creditLimit),
    position: Number(row.position),
    archivedAt: num(row.archivedAt),
    balance: balances.get(row.id) ?? 0,
    loan:
      row.lender === null
        ? null
        : {
            lender: row.lender,
            principal: Number(row.principal),
            startDate: row.startDate as string,
            endDate: row.endDate as string,
            instalment: Number(row.instalment),
            yearlyRate: row.yearlyRate,
            interestSubcategoryId: row.interestSubcategoryId,
          },
    deletable: Number(row.entries) === 0,
  }));
}

/** The live accounts of the account's book, or the archived ones; empty for a book that is not theirs. */
export function listAccounts(
  database: Database,
  accountId: string,
  bookId: string,
  options: { archived?: boolean } = {},
): Promise<AccountRow[]> {
  return read(database, accountId, bookId, options);
}

/** One account, live or archived, or `undefined`: the same answer for one that does not exist and for another person's. */
export async function getAccount(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
): Promise<AccountRow | undefined> {
  return (await read(database, accountId, bookId, { only: moneyAccountId }))[0];
}

/**
 * Makes an account in the account's book, with its opening balance and, for a loan, its terms, **or says why not** and writes nothing. The currency is added
 * to the book's currencies (the ones the daily rates are fetched for, §9.2) if it is not there.
 */
export async function createAccount(
  database: Database,
  accountId: string,
  bookId: string,
  input: NewAccount,
  now: number = Date.now(),
): Promise<WriteResult> {
  const problems = checkNewAccount(input);
  if (problems.length > 0) return { ok: false, reason: 'invalid', problems };
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const id = crypto.randomUUID();
    const inserted = await dbAll<{ id: string }>(
      tx,
      sql`INSERT INTO ${s.moneyAccount}
            (id, book_id, type, name, institution, currency, credit_limit, position, created_at, updated_at)
          SELECT ${id}, b.id, ${input.type}, ${input.name.trim()}, ${input.institution?.trim() || null}, ${input.currency},
                 ${input.creditLimit ?? null},
                 (SELECT COALESCE(MAX(m.position), -1) + 1 FROM ${s.moneyAccount} m WHERE m.book_id = b.id),
                 ${now}, ${now}
            FROM ${bookTable(tx)} b
           WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}
          RETURNING id`,
    );
    if (inserted.length === 0) throw refusal(NOT_FOUND);
    await dbAll(
      tx,
      sql`INSERT INTO ${s.bookCurrency} (book_id, code, created_at)
          SELECT a.book_id, a.currency, ${now} FROM ${s.moneyAccount} a WHERE a.id = ${id} AND a.book_id = ${bookId}
          ON CONFLICT (book_id, code) DO NOTHING
          RETURNING code`,
    );
    const loan = input.loan;
    if (loan) {
      // The subcategory the interest is spent on, if one is named, must be the same book's, in the statement that writes the loan.
      const wrote = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${s.loan}
              (account_id, book_id, lender, principal, start_date, end_date, instalment, yearly_rate, interest_subcategory_id)
            SELECT a.id, a.book_id, ${loan.lender.trim()}, ${loan.principal}, ${loan.startDate}, ${loan.endDate},
                   ${loan.instalment}, ${loan.yearlyRate ?? null}, ${loan.interestSubcategoryId ?? null}
              FROM ${s.moneyAccount} a
             WHERE a.id = ${id} AND a.book_id = ${bookId} AND ${inBook(tx, sql`a.book_id`, accountId)}
               ${
                 loan.interestSubcategoryId
                   ? sql`AND EXISTS (SELECT 1 FROM ${s.subcategory} c WHERE c.id = ${loan.interestSubcategoryId} AND c.book_id = a.book_id)`
                   : sql``
               }
            RETURNING account_id AS id`,
      );
      if (wrote.length === 0) throw refusal(NOT_FOUND);
    }
    const opening = input.opening;
    if (opening && opening.amount !== 0)
      await insertTransaction(
        tx,
        accountId,
        bookId,
        {
          type: 'opening',
          date: opening.date,
          lines: [
            { account: id, amount: opening.amount, currency: input.currency },
            { equity: 'opening', amount: -opening.amount, currency: input.currency },
          ],
        },
        now,
      );
    return id;
  });
}

/**
 * Changes an account's name, institution, a card's limit or a loan's changeable terms. **Never its currency or its kind.** An account that is not theirs is
 * not found; a change that is not allowed for its kind is a sentence, and nothing is written.
 */
export async function updateAccount(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
  patch: AccountPatch,
  now: number = Date.now(),
): Promise<WriteResult> {
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const current = await dbGet<{ type: string; startDate: string | null }>(
      tx,
      sql`SELECT a.type AS type, l.start_date AS "startDate"
            FROM ${s.moneyAccount} a LEFT JOIN ${s.loan} l ON l.account_id = a.id AND l.book_id = a.book_id
           WHERE a.id = ${moneyAccountId} AND a.book_id = ${bookId} AND ${inBook(tx, sql`a.book_id`, accountId)}`,
    );
    if (!current) throw refusal(NOT_FOUND);
    const problems = checkPatch(current.type as AccountType, patch, current.startDate ?? undefined);
    if (problems.length > 0) throw refusal({ ok: false, reason: 'invalid', problems });
    const set = [sql`updated_at = ${now}`];
    if (patch.name !== undefined) set.push(sql`name = ${patch.name.trim()}`);
    if (patch.institution !== undefined)
      set.push(sql`institution = ${patch.institution?.trim() || null}`);
    if (patch.creditLimit !== undefined) set.push(sql`credit_limit = ${patch.creditLimit}`);
    const updated = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.moneyAccount} SET ${sql.join(set, sql`, `)}
           WHERE id = ${moneyAccountId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.moneyAccount.bookId}`, accountId)}
          RETURNING id`,
    );
    if (updated.length === 0) throw refusal(NOT_FOUND);
    const terms = patch.loan;
    if (terms && Object.keys(terms).length > 0) {
      const loanSet = [];
      if (terms.lender !== undefined) loanSet.push(sql`lender = ${terms.lender.trim()}`);
      if (terms.endDate !== undefined) loanSet.push(sql`end_date = ${terms.endDate}`);
      if (terms.instalment !== undefined) loanSet.push(sql`instalment = ${terms.instalment}`);
      if (terms.yearlyRate !== undefined) loanSet.push(sql`yearly_rate = ${terms.yearlyRate}`);
      if (loanSet.length > 0)
        await dbAll(
          tx,
          sql`UPDATE ${s.loan} SET ${sql.join(loanSet, sql`, `)}
               WHERE account_id = ${moneyAccountId} AND book_id = ${bookId} RETURNING account_id`,
        );
    }
    return moneyAccountId;
  });
}

/**
 * Archives an account, or brings it back: it leaves the pickers and the lists and keeps its history and its place in past totals (DESIGN.md §6.1). `true` if it
 * is theirs; `false` for one that is not found. Repeating it changes nothing.
 */
export async function setArchived(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
  archived: boolean,
  now: number = Date.now(),
): Promise<boolean> {
  const s = schema(database);
  const rows = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${s.moneyAccount}
           SET archived_at = ${archived ? sql`COALESCE(archived_at, ${now})` : null}, updated_at = ${now}
         WHERE id = ${moneyAccountId} AND book_id = ${bookId} AND ${inBook(database, sql`${s.moneyAccount.bookId}`, accountId)}
        RETURNING id`,
  );
  return rows.length > 0;
}

export type DeleteAccount = 'deleted' | 'has_entries' | 'not_found';

/**
 * Deletes an account, **only if it has nothing but its opening balance**: the account, that opening and the loan's terms go together, in one transaction.
 * `has_entries` for one that has been used (archive it instead, and it stays in past totals); `not_found` for one that is not theirs or not there. The
 * statement that deletes the account carries the condition, so an entry written between a look and the delete cannot be orphaned.
 */
export async function deleteAccount(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
): Promise<DeleteAccount> {
  return transaction(database, async (tx) => {
    const s = schema(tx);
    const gone = await dbAll<{ id: string }>(
      tx,
      sql`DELETE FROM ${s.moneyAccount}
           WHERE id = ${moneyAccountId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.moneyAccount.bookId}`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.txnLine} x JOIN ${s.txn} t ON t.id = x.txn_id AND t.book_id = x.book_id
                              WHERE x.account_id = ${moneyAccountId} AND x.book_id = ${bookId} AND t.type <> 'opening')
          RETURNING id`,
    );
    if (gone.length === 0) {
      const there = await dbGet<{ id: string }>(
        tx,
        sql`SELECT a.id AS id FROM ${s.moneyAccount} a
             WHERE a.id = ${moneyAccountId} AND a.book_id = ${bookId} AND ${inBook(tx, sql`a.book_id`, accountId)}`,
      );
      return there ? 'has_entries' : 'not_found';
    }
    // Its opening balance: the entries of type opening that have a line on it, with their lines.
    const openings = await dbAll<{ id: string }>(
      tx,
      sql`SELECT DISTINCT t.id AS id FROM ${s.txn} t JOIN ${s.txnLine} x ON x.txn_id = t.id AND x.book_id = t.book_id
           WHERE t.book_id = ${bookId} AND t.type = 'opening' AND x.account_id = ${moneyAccountId}`,
    );
    for (const { id } of openings) {
      await dbAll(
        tx,
        sql`DELETE FROM ${s.txnLine} WHERE txn_id = ${id} AND book_id = ${bookId} RETURNING id`,
      );
      await dbAll(
        tx,
        sql`DELETE FROM ${s.txn} WHERE id = ${id} AND book_id = ${bookId} RETURNING id`,
      );
    }
    await dbAll(
      tx,
      sql`DELETE FROM ${s.loan} WHERE account_id = ${moneyAccountId} AND book_id = ${bookId} RETURNING account_id`,
    );
    // The instalments of a loan that is gone have nothing to pay: they end with it (DESIGN.md §8.3), and nothing of theirs was posted.
    await dbAll(
      tx,
      sql`UPDATE ${s.recurring} SET next_date = NULL, ended_at = COALESCE(ended_at, ${Date.now()}), updated_at = ${Date.now()}
           WHERE loan_account_id = ${moneyAccountId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.recurring.bookId}`, accountId)} RETURNING id`,
    );
    return 'deleted';
  });
}

export interface EntryOfAccount {
  readonly txnId: string;
  readonly date: string;
  readonly type: string;
  readonly note: string | null;
  readonly payee: string | null;
  readonly status: string;
  /** The line on this account, signed: positive when its balance went up. */
  readonly amount: number;
  readonly currency: string;
  /** How many subcategories or income sources the entry is spread over: more than one is a split. */
  readonly parts: number;
}

/**
 * The entries that touch an account, newest first (DESIGN.md §6.9): the line on this account of each, with the entry's date, type, note and status. `limit`
 * entries from `offset`. Another person's account has none.
 */
export async function entriesOf(
  database: Database,
  accountId: string,
  bookId: string,
  moneyAccountId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<EntryOfAccount[]> {
  const s = schema(database);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const rows = await dbAll<{
    txnId: string;
    date: string;
    type: string;
    note: string | null;
    payee: string | null;
    status: string;
    amount: number | string;
    currency: string;
    parts: number | string;
  }>(
    database,
    sql`SELECT t.id AS "txnId", t.date AS date, t.type AS type, t.note AS note, p.name AS payee, t.status AS status,
               x.amount AS amount, x.currency AS currency,
               (SELECT COUNT(*) FROM ${s.txnLine} y WHERE y.txn_id = t.id AND y.book_id = t.book_id
                   AND (y.subcategory_id IS NOT NULL OR y.income_source_id IS NOT NULL)) AS parts
          FROM ${s.txnLine} x JOIN ${s.txn} t ON t.id = x.txn_id AND t.book_id = x.book_id
          LEFT JOIN ${s.payee} p ON p.id = t.payee_id AND p.book_id = t.book_id
         WHERE x.account_id = ${moneyAccountId} AND x.book_id = ${bookId} AND ${inBook(database, sql`x.book_id`, accountId)}
         ORDER BY t.date DESC, t.created_at DESC, t.id DESC, x.position
         LIMIT ${limit} OFFSET ${offset}`,
  );
  return rows.map((row) => ({ ...row, amount: Number(row.amount), parts: Number(row.parts) }));
}
