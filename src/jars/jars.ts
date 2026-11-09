import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { isCalendarDay } from '../dates';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { writeBudget } from '../budget/amounts';
import { isMinor } from '../money/amount';
import { refusal, runWrite, type WriteResult } from '../ledger/transactions';

/**
 * Saving jars (DESIGN.md §10): money set aside **inside a real money account**, an earmark and not an account. A jar's balance is the sum of its movements
 * (positive earmarks, negative releases) and is never stored. **Nothing past what is there**: an earmark cannot make the account's jars exceed its balance and
 * a release cannot take a jar below zero, and both are conditions **of the statement that writes the movement**, taken after a lock on the account's row,
 * so two earmarks racing cannot together exceed it. Every statement carries the permission (`inBook`); a jar or an account that is not the person's reads as one
 * that is not there.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;
const invalid = (...problems: string[]): Extract<WriteResult, { ok: false }> => ({
  ok: false,
  reason: 'invalid',
  problems,
});

export const MAX_JAR_NAME = 60;
/** The kinds of account a jar may be in: where money is held to be spent or kept, not a valued thing. */
export const JAR_ACCOUNT_TYPES = ['bank', 'cash', 'savings', 'deposit'] as const;

export const MOVEMENT_KINDS = ['contribution', 'manual', 'spend'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export interface JarRow {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly currency: string;
  readonly name: string;
  readonly target: number | null;
  readonly position: number;
  readonly archivedAt: number | null;
  /** The sum of its movements. */
  readonly balance: number;
}

/** How far a jar is to its target, from 0 to 1; `null` without a target. **Pure.** */
export function progress(balance: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return Math.min(1, Math.max(0, balance / target));
}

/** What an account holds, what is earmarked in it and what is free; over-earmarked once spending took it below what its jars hold. **Pure.** */
export function accountFigures(
  balance: number,
  inJars: number,
): { balance: number; inJars: number; free: number; overEarmarked: boolean } {
  return { balance, inJars, free: balance - inJars, overEarmarked: balance < inJars };
}

const num = (value: number | string | null): number => (value === null ? 0 : Number(value));

/** The checks of a name, in a sentence. */
export function checkJarName(name: unknown): string | undefined {
  if (typeof name !== 'string' || name.trim() === '') return 'A jar needs a name.';
  if (name.trim().length > MAX_JAR_NAME)
    return `A jar's name is at most ${MAX_JAR_NAME} characters.`;
  return undefined;
}

const checkTarget = (target: unknown): string | undefined =>
  target === null || target === undefined || (isMinor(target) && target > 0)
    ? undefined
    : 'A target is more than nothing, or none.';

/** The jars of the account's book, with balances, in order; `archived` says which kind. */
export async function listJars(
  database: Database,
  accountId: string,
  bookId: string,
  options: { archived?: boolean; moneyAccountId?: string } = {},
): Promise<JarRow[]> {
  const s = schema(database);
  const rows = await dbAll<{
    id: string;
    accountId: string;
    accountName: string;
    currency: string;
    name: string;
    target: number | string | null;
    position: number | string;
    archivedAt: number | string | null;
    balance: number | string | null;
  }>(
    database,
    sql`SELECT j.id AS id, j.account_id AS "accountId", a.name AS "accountName", a.currency AS currency, j.name AS name, j.target AS target,
               j.position AS position, j.archived_at AS "archivedAt",
               (SELECT SUM(m.amount) FROM ${s.jarMovement} m WHERE m.jar_id = j.id AND m.book_id = j.book_id) AS balance
          FROM ${s.jar} j JOIN ${s.moneyAccount} a ON a.id = j.account_id AND a.book_id = j.book_id
         WHERE j.book_id = ${bookId} AND ${inBook(database, sql`j.book_id`, accountId)}
           AND ${options.archived ? sql`j.archived_at IS NOT NULL` : sql`j.archived_at IS NULL`}
           ${options.moneyAccountId ? sql`AND j.account_id = ${options.moneyAccountId}` : sql``}
         ORDER BY a.position, j.position, j.created_at`,
  );
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    accountName: row.accountName,
    currency: row.currency,
    name: row.name,
    target: row.target === null ? null : Number(row.target),
    position: Number(row.position),
    archivedAt: row.archivedAt === null ? null : Number(row.archivedAt),
    balance: num(row.balance),
  }));
}

/** What is earmarked in each account that has jars: account id → the sum of its jars' balances. Archived jars hold nothing (they are archived empty). */
export async function earmarkedByAccount(
  database: Database,
  accountId: string,
  bookId: string,
): Promise<Map<string, number>> {
  const s = schema(database);
  const rows = await dbAll<{ id: string; total: number | string | null }>(
    database,
    sql`SELECT j.account_id AS id, SUM(v.amount) AS total
          FROM ${s.jarMovement} v JOIN ${s.jar} j ON j.id = v.jar_id AND j.book_id = v.book_id
         WHERE v.book_id = ${bookId} AND ${inBook(database, sql`v.book_id`, accountId)}
         GROUP BY j.account_id`,
  );
  return new Map(rows.map((row) => [row.id, num(row.total)]));
}

/**
 * Makes a jar in an account of the person's book, **or says why not**: the account must be one that holds money (a bank account, cash, savings or a
 * deposit), the name is not already a jar's in it, and a target is more than nothing. A monthly contribution, when given, is budgeted from the book's
 * `currentMonth` (a row of the budget history, §7.3).
 */
export async function createJar(
  database: Database,
  accountId: string,
  bookId: string,
  input: { accountId: string; name: string; target?: number | null; monthly?: number | null },
  currentMonth: string,
  now: number = Date.now(),
): Promise<WriteResult> {
  const problems = [checkJarName(input.name), checkTarget(input.target)].filter(
    (each): each is string => each !== undefined,
  );
  if (input.monthly != null && (!isMinor(input.monthly) || input.monthly < 0))
    problems.push('A monthly contribution is not below nothing.');
  if (problems.length > 0) return invalid(...problems);
  const name = input.name.trim();
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const account = await dbGet<{ type: string }>(
      tx,
      sql`SELECT a.type AS type FROM ${s.moneyAccount} a
           WHERE a.id = ${input.accountId} AND a.book_id = ${bookId} AND a.archived_at IS NULL AND ${inBook(tx, sql`a.book_id`, accountId)}`,
    );
    if (!account) throw refusal(NOT_FOUND);
    if (!(JAR_ACCOUNT_TYPES as readonly string[]).includes(account.type))
      throw refusal(invalid('A jar is in a bank account, cash, savings or a deposit.'));
    const id = crypto.randomUUID();
    const inserted = await dbAll<{ id: string }>(
      tx,
      sql`INSERT INTO ${s.jar} (id, book_id, account_id, name, target, position, created_at)
          SELECT ${id}, a.book_id, a.id, ${name}, ${input.target ?? null},
                 (SELECT COALESCE(MAX(j.position), -1) + 1 FROM ${s.jar} j WHERE j.account_id = a.id AND j.book_id = a.book_id), ${now}
            FROM ${s.moneyAccount} a
           WHERE a.id = ${input.accountId} AND a.book_id = ${bookId} AND ${inBook(tx, sql`a.book_id`, accountId)}
             AND NOT EXISTS (SELECT 1 FROM ${s.jar} d WHERE d.account_id = a.id AND d.book_id = a.book_id AND d.archived_at IS NULL AND lower(d.name) = lower(${name}))
          RETURNING id`,
    );
    if (inserted.length === 0)
      throw refusal(invalid('There is already a jar with that name in this account.'));
    if (input.monthly)
      await writeBudget(
        tx,
        accountId,
        bookId,
        { kind: 'jar', targetId: id, amount: input.monthly, when: 'this', currentMonth },
        now,
      );
    return id;
  });
}

/** Renames a jar or changes its target (`null` for none). `not_found` for one that is not theirs. */
export async function updateJar(
  database: Database,
  accountId: string,
  bookId: string,
  jarId: string,
  patch: { name?: string; target?: number | null },
): Promise<WriteResult> {
  const problems = [
    patch.name === undefined ? undefined : checkJarName(patch.name),
    patch.target === undefined ? undefined : checkTarget(patch.target),
  ].filter((each): each is string => each !== undefined);
  if (problems.length > 0) return invalid(...problems);
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const there = await dbGet<{ accountId: string }>(
      tx,
      sql`SELECT j.account_id AS "accountId" FROM ${s.jar} j WHERE j.id = ${jarId} AND j.book_id = ${bookId} AND ${inBook(tx, sql`j.book_id`, accountId)}`,
    );
    if (!there) throw refusal(NOT_FOUND);
    const sets = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name.trim()}`);
    if (patch.target !== undefined) sets.push(sql`target = ${patch.target}`);
    if (sets.length === 0) return jarId;
    if (patch.name !== undefined) {
      const clash = await dbGet<{ id: string }>(
        tx,
        sql`SELECT d.id AS id FROM ${s.jar} d
             WHERE d.account_id = ${there.accountId} AND d.book_id = ${bookId} AND d.archived_at IS NULL AND d.id <> ${jarId}
               AND lower(d.name) = lower(${patch.name.trim()})`,
      );
      if (clash) throw refusal(invalid('There is already a jar with that name in this account.'));
    }
    const updated = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.jar} SET ${sql.join(sets, sql`, `)}
           WHERE id = ${jarId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.jar.bookId}`, accountId)} RETURNING id`,
    );
    if (updated.length === 0) throw refusal(NOT_FOUND);
    return jarId;
  });
}

/**
 * Writes one movement of a jar on a handle already in a transaction: **the lock, then the statement that holds the rule**. The account's row is updated first,
 * which in PostgreSQL waits for any other earmark in the account and in SQLite is a write that serializes, so the check in the next statement sees what the
 * others made. A positive amount must fit in what is free in the account on the date; a negative one must not take the jar below zero. Throws a refusal.
 */
export async function insertMovement(
  tx: Database,
  accountId: string,
  bookId: string,
  input: {
    jarId: string;
    amount: number;
    date: string;
    kind: MovementKind;
    month?: string | null;
    txnId?: string | null;
  },
  now: number,
): Promise<string> {
  const s = schema(tx);
  if (!isMinor(input.amount))
    throw refusal(invalid('An amount is a whole number of the smallest unit.'));
  if (!isCalendarDay(input.date)) throw refusal(invalid('The date is not a day.'));
  const locked = await dbAll<{ id: string }>(
    tx,
    sql`UPDATE ${s.moneyAccount} SET updated_at = ${now}
         WHERE book_id = ${bookId} AND ${inBook(tx, sql`${s.moneyAccount.bookId}`, accountId)}
           AND id = (SELECT j.account_id FROM ${s.jar} j WHERE j.id = ${input.jarId} AND j.book_id = ${bookId} AND j.archived_at IS NULL)
         RETURNING id`,
  );
  if (locked.length === 0) throw refusal(NOT_FOUND);
  const id = crypto.randomUUID();
  const written = await dbAll<{ id: string }>(
    tx,
    sql`INSERT INTO ${s.jarMovement} (id, book_id, jar_id, date, amount, txn_id, kind, month, created_at)
        SELECT ${id}, j.book_id, j.id, ${input.date}, ${input.amount}, ${input.txnId ?? null}, ${input.kind}, ${input.month ?? null}, ${now}
          FROM ${s.jar} j
         WHERE j.id = ${input.jarId} AND j.book_id = ${bookId} AND ${inBook(tx, sql`j.book_id`, accountId)} AND j.archived_at IS NULL
           AND ${
             input.amount > 0
               ? sql`(SELECT COALESCE(SUM(l.amount), 0) FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
                       WHERE l.book_id = j.book_id AND l.account_id = j.account_id AND t.date <= ${input.date})
                     - (SELECT COALESCE(SUM(m.amount), 0) FROM ${s.jarMovement} m JOIN ${s.jar} k ON k.id = m.jar_id AND k.book_id = m.book_id
                         WHERE k.book_id = j.book_id AND k.account_id = j.account_id) >= ${input.amount}`
               : sql`(SELECT COALESCE(SUM(m.amount), 0) FROM ${s.jarMovement} m WHERE m.jar_id = j.id AND m.book_id = j.book_id) + ${input.amount} >= 0`
           }
        RETURNING id`,
  );
  if (written.length === 0)
    throw refusal(
      input.amount > 0
        ? invalid(
            'There is not that much free in the account: some of it is in other jars already.',
          )
        : invalid('The jar holds less than that.'),
    );
  return id;
}

/** Earmarks money in a jar (`direction: 'earmark'`) or releases some (`'release'`), by hand, on a day: `amount` is more than nothing. */
export async function moveMoney(
  database: Database,
  accountId: string,
  bookId: string,
  jarId: string,
  input: { direction: 'earmark' | 'release'; amount: number; date: string },
  now: number = Date.now(),
): Promise<WriteResult> {
  if (!isMinor(input.amount) || input.amount <= 0)
    return invalid('An amount is more than nothing.');
  if (input.direction !== 'earmark' && input.direction !== 'release')
    return invalid('Money is earmarked or released.');
  return runWrite(database, (tx) =>
    insertMovement(
      tx,
      accountId,
      bookId,
      {
        jarId,
        amount: input.direction === 'earmark' ? input.amount : -input.amount,
        date: input.date,
        kind: 'manual',
      },
      now,
    ),
  );
}

/** Archives a jar that holds nothing, or brings one back; a jar with money in it is released first. `not_found` for one that is not theirs. */
export async function setJarArchived(
  database: Database,
  accountId: string,
  bookId: string,
  jarId: string,
  archived: boolean,
  now: number = Date.now(),
): Promise<WriteResult> {
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const jar = await dbGet<{ balance: number | string | null }>(
      tx,
      sql`SELECT (SELECT SUM(m.amount) FROM ${s.jarMovement} m WHERE m.jar_id = j.id AND m.book_id = j.book_id) AS balance
            FROM ${s.jar} j WHERE j.id = ${jarId} AND j.book_id = ${bookId} AND ${inBook(tx, sql`j.book_id`, accountId)}`,
    );
    if (!jar) throw refusal(NOT_FOUND);
    if (archived && num(jar.balance) !== 0)
      throw refusal(invalid('Release what is in the jar before archiving it.'));
    await dbAll(
      tx,
      sql`UPDATE ${s.jar} SET archived_at = ${archived ? now : null}
           WHERE id = ${jarId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.jar.bookId}`, accountId)} RETURNING id`,
    );
    return jarId;
  });
}

/**
 * Moves a jar to another account, **a release from one and an earmark in the other** (DESIGN.md §10.3): the other must be an account of the same currency
 * that holds money, and what the jar holds must be free in it. The check is in the statement that moves it, after the lock on the other account.
 */
export async function moveJar(
  database: Database,
  accountId: string,
  bookId: string,
  jarId: string,
  toAccountId: string,
  today: string,
  now: number = Date.now(),
): Promise<WriteResult> {
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const jar = await dbGet<{ accountId: string; currency: string }>(
      tx,
      sql`SELECT j.account_id AS "accountId", a.currency AS currency FROM ${s.jar} j JOIN ${s.moneyAccount} a ON a.id = j.account_id AND a.book_id = j.book_id
           WHERE j.id = ${jarId} AND j.book_id = ${bookId} AND j.archived_at IS NULL AND ${inBook(tx, sql`j.book_id`, accountId)}`,
    );
    if (!jar) throw refusal(NOT_FOUND);
    if (jar.accountId === toAccountId) return jarId;
    const target = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.moneyAccount} SET updated_at = ${now}
           WHERE id = ${toAccountId} AND book_id = ${bookId} AND archived_at IS NULL AND ${inBook(tx, sql`${s.moneyAccount.bookId}`, accountId)}
             AND type IN (${sql.join(
               JAR_ACCOUNT_TYPES.map((type) => sql`${type}`),
               sql`, `,
             )}) AND currency = ${jar.currency}
           RETURNING id`,
    );
    if (target.length === 0)
      throw refusal(
        (await dbGet(
          tx,
          sql`SELECT 1 AS x FROM ${s.moneyAccount} a WHERE a.id = ${toAccountId} AND a.book_id = ${bookId} AND ${inBook(tx, sql`a.book_id`, accountId)}`,
        ))
          ? invalid('A jar moves to an account that holds money, in the same currency.')
          : NOT_FOUND,
      );
    const moved = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.jar} SET account_id = ${toAccountId},
                 position = (SELECT COALESCE(MAX(k.position), -1) + 1 FROM ${s.jar} k WHERE k.account_id = ${toAccountId} AND k.book_id = ${bookId})
           WHERE id = ${jarId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.jar.bookId}`, accountId)}
             AND (SELECT COALESCE(SUM(m.amount), 0) FROM ${s.jarMovement} m WHERE m.jar_id = ${jarId} AND m.book_id = ${bookId})
               <= (SELECT COALESCE(SUM(l.amount), 0) FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
                    WHERE l.book_id = ${bookId} AND l.account_id = ${toAccountId} AND t.date <= ${today})
                 - (SELECT COALESCE(SUM(m.amount), 0) FROM ${s.jarMovement} m JOIN ${s.jar} k ON k.id = m.jar_id AND k.book_id = m.book_id
                     WHERE k.book_id = ${bookId} AND k.account_id = ${toAccountId})
           RETURNING id`,
    );
    if (moved.length === 0) throw refusal(invalid('There is not that much free in that account.'));
    return jarId;
  });
}
