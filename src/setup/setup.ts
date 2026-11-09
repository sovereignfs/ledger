import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { budgetsForMonth, setBudget } from '../budget/amounts';
import { createCategory, createSubcategory, listCategories } from '../budget/categories';
import {
  createIncomeSource,
  listIncomeSources,
  renameIncomeSource,
} from '../budget/income-sources';
import { listAccounts, createAccount } from '../ledger/accounts';
import type { AccountType } from '../ledger/account-types';
import { type Book, findBook } from '../ledger/books';
import { isMinor } from '../money/amount';
import { isSupportedCurrencyCode } from '../money/currencies';
import { isTimeZone } from './locale';

/**
 * The setup wizard's writes (DESIGN.md §15.3): **each step is a real write** and **each is safe to repeat**, so a refresh loses nothing and going back and
 * forward makes no duplicate. What is done is read from the book itself (`loadSetup`): the next step is the first that is not, and a second call for a step that
 * is done finds what is there instead of making it again. Every statement carries the permission (`inBook`), and the accounts, income sources, categories and
 * budgets are made through the same paths as anywhere else. Nothing is made without the person asking: the suggested categories are made only when chosen.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

/** The kinds of account the wizard offers for the first one: somewhere money is held. Cards, loans and people come after, from the checklist. */
export const FIRST_ACCOUNT_TYPES = ['bank', 'cash', 'savings'] as const;
export const MAX_CATEGORIES = 20;

export interface SetupState {
  readonly done: boolean;
  readonly baseCurrency: string | null;
  readonly timeZone: string;
  /** The first live account, if one has been made. */
  readonly account: {
    id: string;
    name: string;
    type: AccountType;
    currency: string;
    balance: number;
  } | null;
  /** The primary income source, with what it is budgeted this month. */
  readonly income: { id: string; name: string; budgeted: number | null } | null;
  /** How many live subcategories there are, which is what the categories step has made, or the person had made already. */
  readonly subcategories: number;
  /** The first step that is not done: 1 currency, 2 account, 3 income, 4 categories. */
  readonly step: 1 | 2 | 3 | 4;
}

export type SetupResult =
  | { readonly ok: true; readonly state: SetupState }
  | { readonly ok: false; readonly reason: 'invalid'; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: 'not_found' };

const invalid = (...problems: string[]): SetupResult => ({
  ok: false,
  reason: 'invalid',
  problems,
});
const NOT_FOUND: SetupResult = { ok: false, reason: 'not_found' };

/** What is done and what is next, read from the account's own book. */
export async function loadSetup(
  database: Database,
  accountId: string,
  book: Book,
): Promise<SetupState> {
  const [accounts, sources, categories] = await Promise.all([
    listAccounts(database, accountId, book.id),
    listIncomeSources(database, accountId, book.id),
    listCategories(database, accountId, book.id),
  ]);
  const first = accounts[0];
  const primary = sources.find((source) => source.kind === 'primary' && source.archivedAt === null);
  let budgeted: number | null = null;
  if (primary) {
    budgeted =
      (await budgetsForMonth(database, accountId, book.id, monthOf(todayIn(book.timeZone)))).get(
        `income:${primary.id}`,
      ) ?? null;
  }
  const subcategories = categories
    .filter((category) => category.archivedAt === null)
    .reduce(
      (n, category) => n + category.subcategories.filter((sub) => sub.archivedAt === null).length,
      0,
    );
  const step = book.baseCurrency === null ? 1 : !first ? 2 : !primary ? 3 : 4;
  return {
    done: book.setupDoneAt !== null,
    baseCurrency: book.baseCurrency,
    timeZone: book.timeZone,
    account: first
      ? {
          id: first.id,
          name: first.name,
          type: first.type,
          currency: first.currency,
          balance: first.balance,
        }
      : null,
    income: primary ? { id: primary.id, name: primary.name, budgeted } : null,
    subcategories,
    step,
  };
}

/** The account's book as it is now, or `undefined`: it is read again for each step, since a step changes it. */
async function bookOf(
  database: Database,
  accountId: string,
  bookId: string,
): Promise<Book | undefined> {
  const book = await findBook(database, accountId);
  return book && book.id === bookId ? book : undefined;
}

async function done(database: Database, accountId: string, bookId: string): Promise<SetupResult> {
  const book = await bookOf(database, accountId, bookId);
  return book ? { ok: true, state: await loadSetup(database, accountId, book) } : NOT_FOUND;
}

/**
 * Step 1: the base currency, and the time zone the browser said. **It can be done again, and changed**: nothing stored is re-priced (`DESIGN.md` §9.1), and the
 * currency joins the book's currencies for the rates.
 */
export async function setupCurrency(
  database: Database,
  accountId: string,
  bookId: string,
  input: { currency: string; timeZone?: string },
  now: number = Date.now(),
): Promise<SetupResult> {
  if (typeof input.currency !== 'string' || !isSupportedCurrencyCode(input.currency))
    return invalid('Choose a currency.');
  if (input.timeZone !== undefined && !isTimeZone(input.timeZone))
    return invalid('The time zone is not one.');
  const s = schema(database);
  const updated = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${s.book} SET base_currency = ${input.currency}, time_zone = ${input.timeZone ?? sql`time_zone`}, updated_at = ${now}
         WHERE id = ${bookId} AND ${inBook(database, sql`${s.book.id}`, accountId)} RETURNING id`,
  );
  if (updated.length === 0) return NOT_FOUND;
  await dbAll(
    database,
    sql`INSERT INTO ${s.bookCurrency} (book_id, code, created_at)
        SELECT b.id, ${input.currency}, ${now} FROM ${s.book} b WHERE b.id = ${bookId} AND ${inBook(database, sql`b.id`, accountId)}
        ON CONFLICT (book_id, code) DO NOTHING RETURNING code`,
  );
  return done(database, accountId, bookId);
}

/**
 * Step 2: the first account and what is in it today, in the base currency. **If the book has an account already, none is made**: the step finds it, so going back
 * and forward, or a second tap, makes no duplicate.
 */
export async function setupAccount(
  database: Database,
  accountId: string,
  bookId: string,
  input: { type: string; name: string; balance: number | null; date: string },
  now: number = Date.now(),
): Promise<SetupResult> {
  const book = await bookOf(database, accountId, bookId);
  if (!book) return NOT_FOUND;
  if (book.baseCurrency === null) return invalid('Choose the currency first.');
  const existing = await listAccounts(database, accountId, bookId);
  if (existing.length > 0) return done(database, accountId, bookId);
  if (!(FIRST_ACCOUNT_TYPES as readonly string[]).includes(input.type))
    return invalid('The first account is a bank account, cash or savings.');
  const result = await createAccount(
    database,
    accountId,
    bookId,
    {
      type: input.type as AccountType,
      name: input.name,
      currency: book.baseCurrency,
      opening:
        input.balance !== null && input.balance !== 0
          ? { amount: input.balance, date: input.date }
          : null,
    },
    now,
  );
  if (!result.ok)
    return result.reason === 'invalid'
      ? { ok: false, reason: 'invalid', problems: result.problems }
      : NOT_FOUND;
  return done(database, accountId, bookId);
}

/**
 * Step 3: the primary income, its name and what it is budgeted a month. The primary source is **found or made, never made twice**: a repeat renames it if the
 * name changed and sets the budget again, which from this month replaces this month's row and writes no other.
 */
export async function setupIncome(
  database: Database,
  accountId: string,
  bookId: string,
  input: { name: string; amount: number | null },
  now: number = Date.now(),
): Promise<SetupResult> {
  const book = await bookOf(database, accountId, bookId);
  if (!book) return NOT_FOUND;
  if (book.baseCurrency === null) return invalid('Choose the currency first.');
  if (input.amount !== null && (!isMinor(input.amount) || input.amount < 0))
    return invalid('A monthly amount is not below nothing.');
  const sources = await listIncomeSources(database, accountId, bookId);
  const primary = sources.find((source) => source.kind === 'primary' && source.archivedAt === null);
  let id: string;
  if (primary) {
    id = primary.id;
    if (
      typeof input.name === 'string' &&
      input.name.trim() !== '' &&
      input.name.trim() !== primary.name
    ) {
      const renamed = await renameIncomeSource(database, accountId, bookId, id, input.name);
      if (!renamed.ok)
        return renamed.reason === 'invalid'
          ? { ok: false, reason: 'invalid', problems: renamed.problems }
          : NOT_FOUND;
    }
  } else {
    const made = await createIncomeSource(
      database,
      accountId,
      bookId,
      { name: input.name, kind: 'primary', currency: book.baseCurrency },
      now,
    );
    if (!made.ok)
      return made.reason === 'invalid'
        ? { ok: false, reason: 'invalid', problems: made.problems }
        : NOT_FOUND;
    id = made.id;
  }
  if (input.amount !== null && input.amount > 0) {
    const set = await setBudget(
      database,
      accountId,
      bookId,
      {
        kind: 'income',
        targetId: id,
        amount: input.amount,
        when: 'this',
        currentMonth: monthOf(todayIn(book.timeZone)),
      },
      now,
    );
    if (!set.ok)
      return set.reason === 'invalid'
        ? { ok: false, reason: 'invalid', problems: set.problems }
        : NOT_FOUND;
  }
  return done(database, accountId, bookId);
}

/**
 * Step 4: the first categories, **only those chosen**. Each chosen name becomes a category with a subcategory of the same name, in the base currency, with the
 * amount as its budget from this month. A name that is there already is found, not made again, so going back and forward, or choosing it twice, makes no
 * duplicate. Nothing is made for what was not chosen.
 */
export async function setupCategories(
  database: Database,
  accountId: string,
  bookId: string,
  items: readonly { name: string; amount: number | null }[],
  now: number = Date.now(),
): Promise<SetupResult> {
  const book = await bookOf(database, accountId, bookId);
  if (!book) return NOT_FOUND;
  if (book.baseCurrency === null) return invalid('Choose the currency first.');
  if (items.length > MAX_CATEGORIES)
    return invalid(
      `Choose at most ${MAX_CATEGORIES} categories here; the rest can be made afterwards.`,
    );
  for (const item of items)
    if (item.amount !== null && (!isMinor(item.amount) || item.amount < 0))
      return invalid('A budgeted amount is not below nothing.');
  const month = monthOf(todayIn(book.timeZone));
  for (const item of items) {
    const name = item.name.trim();
    let categories = await listCategories(database, accountId, bookId);
    let category = categories.find((each) => each.name.toLowerCase() === name.toLowerCase());
    if (!category) {
      const made = await createCategory(
        database,
        accountId,
        bookId,
        { name, currency: book.baseCurrency },
        now,
      );
      if (!made.ok)
        return made.reason === 'invalid'
          ? { ok: false, reason: 'invalid', problems: made.problems }
          : NOT_FOUND;
      categories = await listCategories(database, accountId, bookId);
      category = categories.find((each) => each.id === made.id);
    }
    if (!category) return NOT_FOUND;
    let subId = category.subcategories.find(
      (each) => each.name.toLowerCase() === name.toLowerCase(),
    )?.id;
    if (!subId) {
      const made = await createSubcategory(database, accountId, bookId, category.id, { name }, now);
      if (!made.ok)
        return made.reason === 'invalid'
          ? { ok: false, reason: 'invalid', problems: made.problems }
          : NOT_FOUND;
      subId = made.id;
    }
    if (item.amount !== null && item.amount > 0) {
      const set = await setBudget(
        database,
        accountId,
        bookId,
        {
          kind: 'subcategory',
          targetId: subId,
          amount: item.amount,
          when: 'this',
          currentMonth: month,
        },
        now,
      );
      if (!set.ok)
        return set.reason === 'invalid'
          ? { ok: false, reason: 'invalid', problems: set.problems }
          : NOT_FOUND;
    }
  }
  return done(database, accountId, bookId);
}

/** Finishes setup: `setup_done_at` is set once and kept; a repeat changes nothing. Anything not done may be done later, from Overview's checklist. */
export async function finishSetup(
  database: Database,
  accountId: string,
  bookId: string,
  now: number = Date.now(),
): Promise<SetupResult> {
  const s = schema(database);
  await dbAll(
    database,
    sql`UPDATE ${s.book} SET setup_done_at = ${now}, updated_at = ${now}
         WHERE id = ${bookId} AND setup_done_at IS NULL AND ${inBook(database, sql`${s.book.id}`, accountId)} RETURNING id`,
  );
  const there = await dbGet<{ id: string }>(
    database,
    sql`SELECT b.id AS id FROM ${s.book} b WHERE b.id = ${bookId} AND ${inBook(database, sql`b.id`, accountId)}`,
  );
  return there ? done(database, accountId, bookId) : NOT_FOUND;
}
