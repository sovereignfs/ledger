import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { bookTable } from '../ledger/books';
import { getEntry } from '../ledger/entries';
import {
  insertTransaction,
  refusal,
  runWrite,
  verifyTargets,
  type WriteResult,
} from '../ledger/transactions';
import { type LineInput, type TxnInput, checkShape } from '../ledger/validate';
import { subcategoriesOf, syncBills } from './bills';
import { loanEntry } from './loan-entry';
import { type Rule, checkRule, nextOccurrence } from './rule';

/**
 * Recurring entries (DESIGN.md §8.2): **a template of a transaction with a repeat rule, a mode and the date of its next occurrence**. In mode `auto` the job
 * posts it on its day (`./job.ts`); in mode `confirm` it waits for the person (task 6.3). Every statement carries the permission (`inBook`), and the template's
 * accounts, subcategories and income sources must be the same book's, which is checked by the very path a transaction is written through.
 *
 * **Posting an occurrence is idempotent and safe from two processes at once.** `next_date` is the next occurrence not yet handled, and moving it on is a
 * conditional update (`WHERE next_date = <that occurrence>`): of any number that try, one wins and posts; the transaction carries `(recurring_id,
 * occurrence_date)`, unique, as the backstop. The claim and the posting are **one database transaction**, so a posting that is refused leaves `next_date`
 * where it was and the occurrence is tried again, and a posting that succeeds has moved it on. Editing a recurring entry changes the occurrences to come and
 * no transaction already posted.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;
const invalid = (...problems: string[]): Extract<WriteResult, { ok: false }> => ({
  ok: false,
  reason: 'invalid',
  problems,
});

export const MODES = ['auto', 'confirm'] as const;
export type Mode = (typeof MODES)[number];

/** What a recurring entry posts: the kinds of entry that repeat, with their lines (as an entry's own, in the account's currency), payee and note. */
export interface Template {
  readonly type: 'expense' | 'income' | 'transfer';
  readonly lines: readonly LineInput[];
  readonly payee: string | null;
  readonly note: string | null;
}

export interface RecurringRow {
  readonly id: string;
  readonly template: Template;
  readonly rule: Rule;
  readonly mode: Mode;
  /** The next occurrence not yet handled, or `null` once the rule has run its course. */
  readonly nextDate: string | null;
  /** When it was ended, by the person or because its last occurrence was handled. */
  readonly endedAt: number | null;
  readonly loanAccountId: string | null;
}

interface Raw {
  id: string;
  template: string;
  unit: string;
  every: number | string;
  anchorDate: string;
  endDate: string | null;
  mode: string;
  nextDate: string | null;
  endedAt: number | string | null;
  loanAccountId: string | null;
}

const COLUMNS = (alias: string) =>
  sql.raw(
    `${alias}.id AS id, ${alias}.template AS template, ${alias}.unit AS unit, ${alias}.every AS "every", ${alias}.anchor_date AS "anchorDate", ${alias}.end_date AS "endDate", ${alias}.mode AS mode, ${alias}.next_date AS "nextDate", ${alias}.ended_at AS "endedAt", ${alias}.loan_account_id AS "loanAccountId"`,
  );

/** A stored template, or `undefined` for text that is not one: what is read from the database is not trusted to be what was written. */
export function parseTemplate(text: string): Template | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return undefined;
    const { type, lines, payee, note } = value as Record<string, unknown>;
    if ((type !== 'expense' && type !== 'income' && type !== 'transfer') || !Array.isArray(lines))
      return undefined;
    return {
      type,
      lines: lines as LineInput[],
      payee: typeof payee === 'string' ? payee : null,
      note: typeof note === 'string' ? note : null,
    };
  } catch {
    return undefined;
  }
}

function toRow(row: Raw): RecurringRow | undefined {
  const template = parseTemplate(row.template);
  if (!template) return undefined;
  return {
    id: row.id,
    template,
    rule: {
      unit: row.unit as Rule['unit'],
      every: Number(row.every),
      anchor: row.anchorDate,
      end: row.endDate,
    },
    mode: row.mode === 'confirm' ? 'confirm' : 'auto',
    nextDate: row.nextDate,
    endedAt: row.endedAt === null ? null : Number(row.endedAt),
    loanAccountId: row.loanAccountId,
  };
}

/** The entry a template makes on a day: the template's own lines, payee and note, dated, and pending. */
function entryOf(
  template: Template,
  date: string,
  recurring?: { id: string; occurrenceDate: string },
): TxnInput {
  return {
    type: template.type,
    date,
    lines: template.lines,
    note: template.note,
    payee: template.payee,
    ...(recurring ? { recurring } : {}),
  };
}

/** The account's recurring entries, live ones first by their next date, then the ended. Empty for a book that is not theirs. */
export async function listRecurring(
  database: Database,
  accountId: string,
  bookId: string,
): Promise<RecurringRow[]> {
  const s = schema(database);
  const rows = await dbAll<Raw>(
    database,
    sql`SELECT ${COLUMNS('r')} FROM ${s.recurring} r
         WHERE r.book_id = ${bookId} AND ${inBook(database, sql`r.book_id`, accountId)}
         ORDER BY CASE WHEN r.ended_at IS NULL THEN 0 ELSE 1 END, r.next_date, r.created_at, r.id`,
  );
  return rows.flatMap((row) => toRow(row) ?? []);
}

async function one(
  database: Database,
  accountId: string,
  bookId: string,
  id: string,
): Promise<RecurringRow | undefined> {
  const s = schema(database);
  const row = await dbGet<Raw>(
    database,
    sql`SELECT ${COLUMNS('r')} FROM ${s.recurring} r
         WHERE r.id = ${id} AND r.book_id = ${bookId} AND ${inBook(database, sql`r.book_id`, accountId)}`,
  );
  return row ? toRow(row) : undefined;
}

export interface NewRecurring {
  readonly template: Template;
  readonly unit: Rule['unit'];
  readonly every: number;
  /** The first occurrence. */
  readonly anchor: string;
  readonly end?: string | null;
  readonly mode: Mode;
  /** Whether the anchor's own occurrence has been posted already (an entry made repeat): then the next is the one after it. */
  readonly posted?: boolean;
  /** A loan whose instalment this is: the split of each posting is worked out when it is posted (`loan-entry.ts`). */
  readonly loanAccountId?: string;
}

/** What is wrong with a template and a rule and a mode, from the input alone, in sentences. */
function checkNew(input: NewRecurring): string[] {
  const problems = [
    ...checkRule({
      unit: input.unit,
      every: input.every,
      anchor: input.anchor,
      end: input.end ?? null,
    }),
  ];
  if (!(MODES as readonly string[]).includes(input.mode))
    problems.push('A repeat posts itself or waits to be confirmed.');
  if (!['expense', 'income', 'transfer'].includes(input.template.type))
    problems.push('Only an expense, an income or a transfer repeats.');
  else
    problems.push(
      ...checkShape(
        entryOf(input.template, problems.length === 0 ? input.anchor : '2000-01-01'),
      ).filter((each) => !problems.includes(each)),
    );
  return [...new Set(problems)];
}

/** Writes the recurring entry on a handle already in a transaction; throws a refusal that `runWrite` turns into the answer. */
export async function insertRecurring(
  tx: Database,
  accountId: string,
  bookId: string,
  input: NewRecurring,
  now: number,
): Promise<string> {
  const problems = checkNew(input);
  if (problems.length > 0) throw refusal(invalid(...problems));
  const s = schema(tx);
  const rule: Rule = {
    unit: input.unit,
    every: input.every,
    anchor: input.anchor,
    end: input.end ?? null,
  };
  const next = input.posted ? nextOccurrence(rule, input.anchor) : input.anchor;
  const id = crypto.randomUUID();
  const inserted = await dbAll<{ id: string }>(
    tx,
    sql`INSERT INTO ${s.recurring} (id, book_id, template, unit, every, anchor_date, end_date, mode, next_date, loan_account_id, ended_at, created_at, updated_at)
        SELECT ${id}, b.id, ${JSON.stringify(input.template)}, ${rule.unit}, ${rule.every}, ${rule.anchor}, ${rule.end}, ${input.mode}, ${next},
               ${input.loanAccountId ?? null}, ${next === null ? now : null}, ${now}, ${now}
          FROM ${bookTable(tx)} b
         WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}
        RETURNING id`,
  );
  if (inserted.length === 0) throw refusal(NOT_FOUND);
  // What the template points at must be the book's and be what its lines say: the same check a transaction is written under.
  await verifyTargets(tx, accountId, bookId, entryOf(input.template, rule.anchor));
  await syncBills(tx, accountId, bookId, subcategoriesOf(input.template), now);
  return id;
}

/** Makes a recurring entry from a template and a rule: **from scratch**, its first occurrence the anchor itself, which is posted when it falls due. */
export async function createRecurring(
  database: Database,
  accountId: string,
  bookId: string,
  input: NewRecurring,
  now: number = Date.now(),
): Promise<WriteResult> {
  const problems = checkNew(input);
  if (problems.length > 0) return invalid(...problems);
  return runWrite(database, (tx) => insertRecurring(tx, accountId, bookId, input, now));
}

/**
 * Makes an entry that was written repeat (**"Repeat…"**, DESIGN.md §8.2): its lines, payee and note are the template, its date the anchor, and **the entry itself
 * is the anchor's occurrence**, tied to the series, so the next to post is the one after it and nothing is posted twice. An opening balance, an adjustment and
 * a new value do not repeat; one that repeats already is not made to again.
 */
export async function repeatEntry(
  database: Database,
  accountId: string,
  bookId: string,
  entryId: string,
  rule: { unit: Rule['unit']; every: number; end?: string | null; mode: Mode },
  now: number = Date.now(),
): Promise<WriteResult> {
  const entry = await getEntry(database, accountId, bookId, entryId);
  if (!entry) return NOT_FOUND;
  if (entry.type !== 'expense' && entry.type !== 'income' && entry.type !== 'transfer')
    return invalid('Only an expense, an income or a transfer repeats.');
  const s = schema(database);
  return runWrite(database, async (tx) => {
    const id = await insertRecurring(
      tx,
      accountId,
      bookId,
      {
        template: {
          type: entry.type as Template['type'],
          lines: entry.lines,
          payee: entry.payee?.name ?? null,
          note: entry.note,
        },
        unit: rule.unit,
        every: rule.every,
        anchor: entry.date,
        end: rule.end ?? null,
        mode: rule.mode,
        posted: true,
      },
      now,
    );
    const tied = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.txn} SET recurring_id = ${id}, occurrence_date = ${entry.date}
           WHERE id = ${entryId} AND book_id = ${bookId} AND recurring_id IS NULL AND ${inBook(tx, sql`${s.txn.bookId}`, accountId)} RETURNING id`,
    );
    if (tied.length === 0) throw refusal(invalid('This entry repeats already.'));
    return id;
  });
}

export interface RecurringPatch {
  readonly mode?: Mode;
  /** A new end day, or `null` for none. */
  readonly end?: string | null;
  /** A new repeat: counted from the next occurrence, which stays where it is. */
  readonly unit?: Rule['unit'];
  readonly every?: number;
  readonly template?: Template;
}

/**
 * Changes the occurrences to come: the mode, the end, how often (counted from the next occurrence, which stays), or the template. **No transaction already posted
 * is touched.** An end that is before the next occurrence ends the entry. `not_found` for one that is not theirs.
 */
export async function updateRecurring(
  database: Database,
  accountId: string,
  bookId: string,
  id: string,
  patch: RecurringPatch,
  now: number = Date.now(),
): Promise<WriteResult> {
  if (patch.mode !== undefined && !(MODES as readonly string[]).includes(patch.mode))
    return invalid('A repeat posts itself or waits to be confirmed.');
  const s = schema(database);
  return runWrite(database, async (tx) => {
    const row = await one(tx, accountId, bookId, id);
    if (!row) throw refusal(NOT_FOUND);
    if (
      row.endedAt !== null &&
      patch.end === undefined &&
      patch.unit === undefined &&
      patch.every === undefined &&
      patch.template === undefined &&
      patch.mode === undefined
    )
      return id;
    const anchor =
      patch.unit !== undefined || patch.every !== undefined
        ? (row.nextDate ?? row.rule.anchor)
        : row.rule.anchor;
    const rule: Rule = {
      unit: patch.unit ?? row.rule.unit,
      every: patch.every ?? row.rule.every,
      anchor,
      end: patch.end === undefined ? row.rule.end : patch.end,
    };
    const template = patch.template ?? row.template;
    const problems = [...checkRule(rule), ...checkShape(entryOf(template, rule.anchor))];
    if (problems.length > 0) throw refusal(invalid(...new Set(problems)));
    if (patch.template) await verifyTargets(tx, accountId, bookId, entryOf(template, rule.anchor));
    // An end before the next occurrence leaves nothing to come.
    const next =
      row.nextDate !== null && rule.end !== null && row.nextDate > rule.end ? null : row.nextDate;
    const updated = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.recurring}
             SET template = ${JSON.stringify(template)}, unit = ${rule.unit}, every = ${rule.every}, anchor_date = ${rule.anchor}, end_date = ${rule.end},
                 mode = ${patch.mode ?? row.mode}, next_date = ${next},
                 ended_at = ${row.endedAt ?? (next === null ? now : null)}, updated_at = ${now}
           WHERE id = ${id} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.recurring.bookId}`, accountId)} RETURNING id`,
    );
    if (updated.length === 0) throw refusal(NOT_FOUND);
    await syncBills(
      tx,
      accountId,
      bookId,
      [...subcategoriesOf(row.template), ...subcategoriesOf(template)],
      now,
    );
    return id;
  });
}

/** Ends a recurring entry: nothing more is posted or offered; what was posted stays. Repeating it changes nothing. `false` for one that is not theirs. */
export async function endRecurring(
  database: Database,
  accountId: string,
  bookId: string,
  id: string,
  now: number = Date.now(),
): Promise<boolean> {
  const s = schema(database);
  return transaction(database, async (tx) => {
    const row = await one(tx, accountId, bookId, id);
    if (!row) return false;
    const rows = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${s.recurring} SET ended_at = COALESCE(ended_at, ${now}), updated_at = ${now}
           WHERE id = ${id} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.recurring.bookId}`, accountId)} RETURNING id`,
    );
    if (rows.length === 0) return false;
    await syncBills(tx, accountId, bookId, subcategoriesOf(row.template), now);
    return true;
  });
}

/**
 * Takes the entry's next occurrence for this process and moves the entry on to the one after (ending it after its last): a conditional update that says who won,
 * so two that try at once take it once. The caller handles what the occurrence is, in the same transaction.
 */
async function claim(
  tx: Database,
  accountId: string,
  bookId: string,
  row: RecurringRow,
  now: number,
): Promise<boolean> {
  const s = schema(tx);
  const date = row.nextDate;
  if (date === null) return false;
  const following = nextOccurrence(row.rule, date);
  const claimed = await dbAll<{ id: string }>(
    tx,
    sql`UPDATE ${s.recurring} SET next_date = ${following}, ended_at = ${following === null ? now : null}, updated_at = ${now}
         WHERE id = ${row.id} AND book_id = ${bookId} AND next_date = ${date} AND ended_at IS NULL
           AND ${inBook(tx, sql`${s.recurring.bookId}`, accountId)}
        RETURNING id`,
  );
  if (claimed.length > 0 && following === null)
    await syncBills(tx, accountId, bookId, subcategoriesOf(row.template), now);
  return claimed.length > 0;
}

/** Ends the entry here and now, with nothing to come: a loan that is paid off. */
async function endNow(
  tx: Database,
  accountId: string,
  bookId: string,
  id: string,
  now: number,
): Promise<void> {
  const s = schema(tx);
  await dbAll(
    tx,
    sql`UPDATE ${s.recurring} SET next_date = NULL, ended_at = COALESCE(ended_at, ${now}), updated_at = ${now}
         WHERE id = ${id} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.recurring.bookId}`, accountId)} RETURNING id`,
  );
}

export type PostResult =
  | { readonly status: 'posted'; readonly date: string }
  /** The occurrence was one the person skipped, or was posted already: the entry is moved on and nothing is made. */
  | { readonly status: 'passed'; readonly date: string }
  /** Nothing is due: the entry has ended, has no next date, or its next date is after `dueOn`. */
  | { readonly status: 'none' }
  /** Another process took this occurrence between the look and the claim. */
  | { readonly status: 'lost' }
  /** The occurrence asked for is not the entry's next: it was handled meanwhile, here or in another window. */
  | { readonly status: 'stale' }
  /** The template no longer makes a valid entry (an account archived, a subcategory deleted): the entry stays due and is tried again, never wedged. */
  | { readonly status: 'failed'; readonly problems: readonly string[] };

/**
 * Posts the next occurrence of a recurring entry if it is **due on or before `dueOn`**, as the account `actingAccountId` (for the job, the book's owner), and
 * moves the entry on to the one after: **one transaction**, the claim (`WHERE next_date = <the occurrence>`) first and the posting after, so two that try at
 * once post it once and a posting that is refused moves nothing. A skipped occurrence, or one already posted, only moves the entry on. The last occurrence
 * ends the entry.
 */
export interface PostOptions {
  /** Post this in place of the stored template (a corrected amount, when a person confirms). */
  readonly template?: Template;
  /** The occurrence the person was shown: if the entry's next is another, nothing is posted and the answer is `stale`. */
  readonly expect?: string;
}

export async function postOccurrence(
  database: Database,
  actingAccountId: string,
  bookId: string,
  recurringId: string,
  dueOn: string,
  now: number = Date.now(),
  options: PostOptions = {},
): Promise<PostResult> {
  const s = schema(database);
  let outcome: PostResult = { status: 'none' };
  const result = await runWrite(database, async (tx) => {
    const row = await one(tx, actingAccountId, bookId, recurringId);
    if (!row || row.endedAt !== null || row.nextDate === null) return recurringId;
    if (options.expect !== undefined && row.nextDate !== options.expect) {
      outcome = { status: 'stale' };
      return recurringId;
    }
    if (row.nextDate > dueOn) return recurringId;
    const date = row.nextDate;
    if (!(await claim(tx, actingAccountId, bookId, row, now))) {
      outcome = { status: 'lost' };
      return recurringId;
    }
    const skipped = await dbGet<{ n: number | string }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${s.recurringSkip} k WHERE k.recurring_id = ${recurringId} AND k.book_id = ${bookId} AND k.occurrence_date = ${date}`,
    );
    const posted = await dbGet<{ n: number | string }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${s.txn} t WHERE t.book_id = ${bookId} AND t.recurring_id = ${recurringId} AND t.occurrence_date = ${date}`,
    );
    if (Number(skipped?.n) > 0 || Number(posted?.n) > 0) {
      outcome = { status: 'passed', date };
      return recurringId;
    }
    let entry = entryOf(options.template ?? row.template, date, {
      id: recurringId,
      occurrenceDate: date,
    });
    let finishes = false;
    if (row.loanAccountId) {
      // A loan's instalment: split into interest and principal on the day, and the last one capped at what is left (DESIGN.md §8.3).
      const payer = row.template.lines.find((line) => line.account !== undefined)?.account;
      const planned = await loanEntry(tx, actingAccountId, bookId, {
        recurringId,
        loanAccountId: row.loanAccountId,
        payerAccountId: payer ?? '',
        date,
        ...(options.template
          ? { instalment: Math.abs(options.template.lines[0]?.amount ?? 0) }
          : {}),
      });
      if (planned.kind === 'problem') throw refusal(invalid(...planned.problems));
      if (planned.kind === 'paid_off') {
        await endNow(tx, actingAccountId, bookId, recurringId, now);
        outcome = { status: 'passed', date };
        return recurringId;
      }
      entry = { ...planned.entry, recurring: { id: recurringId, occurrenceDate: date } };
      finishes = planned.last;
    }
    await insertTransaction(tx, actingAccountId, bookId, entry, now);
    // The entry ends with the loan: its last instalment leaves nothing to come.
    if (finishes) await endNow(tx, actingAccountId, bookId, recurringId, now);
    outcome = { status: 'posted', date };
    return recurringId;
  });
  if (!result.ok)
    return result.reason === 'invalid'
      ? { status: 'failed', problems: result.problems }
      : { status: 'none' };
  return outcome;
}

/**
 * Skips the entry's next occurrence, which must be the one the person was shown (`date`): it is recorded as skipped and the entry moves on to the one after, in
 * one transaction. Nothing is posted. `not_found` for an entry that is not theirs or has ended, `stale` when the next occurrence is another (handled already).
 */
export async function skipOccurrence(
  database: Database,
  accountId: string,
  bookId: string,
  recurringId: string,
  date: string,
  now: number = Date.now(),
): Promise<'skipped' | 'not_found' | 'stale'> {
  const s = schema(database);
  let outcome: 'skipped' | 'not_found' | 'stale' = 'not_found';
  await runWrite(database, async (tx) => {
    const row = await one(tx, accountId, bookId, recurringId);
    if (!row || row.endedAt !== null || row.nextDate === null) return recurringId;
    if (row.nextDate !== date || !(await claim(tx, accountId, bookId, row, now))) {
      outcome = 'stale';
      return recurringId;
    }
    await dbAll(
      tx,
      sql`INSERT INTO ${s.recurringSkip} (recurring_id, occurrence_date, book_id)
          SELECT ${recurringId}, ${date}, ${bookId} FROM ${s.recurring} r
           WHERE r.id = ${recurringId} AND r.book_id = ${bookId} AND ${inBook(tx, sql`r.book_id`, accountId)}
          ON CONFLICT (recurring_id, occurrence_date) DO NOTHING RETURNING recurring_id`,
    );
    outcome = 'skipped';
    return recurringId;
  });
  return outcome;
}

export interface Upcoming {
  readonly id: string;
  readonly template: Template;
  /** The occurrence: the entry's next day. */
  readonly date: string;
  /** Before today by the book's clock, today, or still to come within the look-ahead. */
  readonly state: 'overdue' | 'due' | 'coming';
}

/** A day some days on, as UTC calendar arithmetic. */
function plusDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The occurrences waiting to be confirmed (DESIGN.md §8.2): the next of each entry in mode `confirm`, **overdue** ones included (they stay until handled), and the
 * ones due within `lookAheadDays` of today by the book's clock. One row for each entry: when it is handled the following occurrence is the next row.
 */
export async function listUpcoming(
  database: Database,
  accountId: string,
  bookId: string,
  timeZone: string,
  now: Date = new Date(),
  lookAheadDays = 7,
): Promise<Upcoming[]> {
  const today = todayIn(timeZone, now);
  const horizon = plusDays(today, lookAheadDays);
  const s = schema(database);
  const rows = await dbAll<Raw>(
    database,
    sql`SELECT ${COLUMNS('r')} FROM ${s.recurring} r
         WHERE r.book_id = ${bookId} AND ${inBook(database, sql`r.book_id`, accountId)}
           AND r.mode = 'confirm' AND r.ended_at IS NULL AND r.next_date IS NOT NULL AND r.next_date <= ${horizon}
         ORDER BY r.next_date, r.id`,
  );
  const out: Upcoming[] = [];
  for (const raw of rows) {
    const row = toRow(raw);
    if (!row || row.nextDate === null) continue;
    out.push({
      id: row.id,
      template: row.template,
      date: row.nextDate,
      state: row.nextDate < today ? 'overdue' : row.nextDate === today ? 'due' : 'coming',
    });
  }
  return out;
}

export interface PostDueResult {
  readonly posted: number;
  readonly passed: number;
  readonly failed: number;
}

/** At most this many occurrences of one recurring entry are caught up in one run: a daily entry left for a year is caught up in a few runs, not one. */
export const CATCH_UP_LIMIT = 400;

/**
 * Posts everything that is due, **for every book on the instance**, as the job does (DESIGN.md §8.2): the entries in mode `auto` whose next date has come in
 * **their book's own time zone**, each caught up occurrence by occurrence, so a server down for three days posts the three missed ones once each. Safe to run
 * twice and from two processes: each occurrence is claimed by the database (`postOccurrence`). A template that no longer makes a valid entry is counted as
 * failed and left due, and never stops the others. Acts as the book's owner; a book with none is left alone.
 */
export async function postDue(database: Database, now: Date = new Date()): Promise<PostDueResult> {
  const s = schema(database);
  // A day past UTC's today is the furthest any zone's "today" can be, so nothing due anywhere is missed by this look; each entry's own book decides below.
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const due = await dbAll<{ id: string; bookId: string; timeZone: string }>(
    database,
    sql`SELECT r.id AS id, r.book_id AS "bookId", b.time_zone AS "timeZone"
          FROM ${s.recurring} r JOIN ${s.book} b ON b.id = r.book_id
         WHERE r.mode = 'auto' AND r.ended_at IS NULL AND r.next_date IS NOT NULL AND r.next_date <= ${horizon}
         ORDER BY r.next_date, r.id`,
  );
  const owners = new Map<string, string | undefined>();
  const result = { posted: 0, passed: 0, failed: 0 };
  for (const entry of due) {
    if (!owners.has(entry.bookId)) {
      const owner = await dbGet<{ accountId: string }>(
        database,
        sql`SELECT m.account_id AS "accountId" FROM ${s.bookMember} m WHERE m.book_id = ${entry.bookId} AND m.role = 'owner' ORDER BY m.created_at LIMIT 1`,
      );
      owners.set(entry.bookId, owner?.accountId);
    }
    const owner = owners.get(entry.bookId);
    if (!owner) continue;
    const today = todayIn(entry.timeZone, now);
    for (let n = 0; n < CATCH_UP_LIMIT; n++) {
      const outcome = await postOccurrence(
        database,
        owner,
        entry.bookId,
        entry.id,
        today,
        now.getTime(),
      );
      if (outcome.status === 'posted') result.posted++;
      else if (outcome.status === 'passed') result.passed++;
      else {
        if (outcome.status === 'failed') result.failed++;
        break;
      }
    }
  }
  return result;
}
