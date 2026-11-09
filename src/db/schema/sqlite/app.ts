import { index, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { bool, counter, decimal, epochMs, id, isoDate, money, ref } from './columns';

/**
 * What the app holds, in the app store (DESIGN.md §18.3). An account is better-auth's, in the other store, so `account_id` is a reference by
 * value and never a foreign key; there are none, and every deletion names what it deletes (`People.deletePerson`, task 2.5). The tables of
 * later tasks are added by their own migrations.
 */

/**
 * Counts for rate limits, in the database so that a limit holds across every process: a key, when its window began, and how many have been
 * counted in it (`src/limits/rate.ts`). Swept when a window is long over.
 */
export const rateBucket = sqliteTable(
  'rate_bucket',
  {
    key: id('key'),
    windowStart: epochMs('window_start').notNull(),
    count: counter('count').notNull(),
  },
  (table) => [index('rate_bucket_window_idx').on(table.windowStart)],
);

/**
 * A book: everything of one budget (DESIGN.md §5.3). In phase 1 each person has exactly one, made at their first sign-in with its id derived from
 * theirs (`src/ledger/books.ts`), so two requests that make it at once make the same row. Its currency is empty until setup chooses one.
 */
export const book = sqliteTable('book', {
  id: id('id'),
  name: text('name').notNull(),
  /** The currency of totals and reports (ISO 4217); null until setup (task 9.1). */
  baseCurrency: text('base_currency'),
  /** An IANA zone, which decides what "today" and a month are for posting and the recap (DESIGN.md §15.2). */
  timeZone: text('time_zone').notNull().default('UTC'),
  /** 0 is Sunday, 1 is Monday. */
  firstDayOfWeek: counter('first_day_of_week').notNull().default(1),
  /** The locale numbers are written in, a BCP 47 tag; null means the person's browser decides. */
  locale: text('locale'),
  /** Whether the monthly recap is sent (DESIGN.md §11.5). */
  recap: bool('recap').notNull().default(true),
  /** When setup was finished; null until then. */
  setupDoneAt: epochMs('setup_done_at'),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/**
 * Who a book is for. **The permission is membership of this table**, as a condition of the statement that reads or writes a row of the book
 * (`src/access/book.ts`). `account_id` is better-auth's user id, in the other store, so a reference by value and not a foreign key. Phase 1 has the
 * `owner` role alone and one member; households arrive later without a rewrite.
 */
export const bookMember = sqliteTable(
  'book_member',
  {
    bookId: ref('book_id').notNull(),
    accountId: ref('account_id').notNull(),
    role: text('role').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bookId, table.accountId] }),
    index('book_member_account_idx').on(table.accountId),
  ],
);

/**
 * The currencies a book uses (DESIGN.md §9.1): the ones its accounts and categories name, added when one needs one, and the ones the daily rate fetch is
 * asked for (task 3.3). The code is an ISO 4217 one from `src/money/currencies.ts`, checked where it is written.
 */
export const bookCurrency = sqliteTable(
  'book_currency',
  {
    bookId: ref('book_id').notNull(),
    code: text('code').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.code] })],
);

/**
 * What a currency was worth in US dollars on a day (DESIGN.md §9.2): `rate` is how many units of `currency` one US dollar buys, as a decimal string, never a
 * float, so that conversion is exact (§9.3). **Instance-wide and no book's**: it has no `book_id`, holds nothing of a person, and is not deleted with one. A row is
 * the day the source says the rate is for (`as_of`, which is the last working day on a weekend), so two fetches on one day make one row. USD itself has no row: it
 * is the pivot, and its rate is one by definition (`src/fx/`).
 */
export const fxRate = sqliteTable(
  'fx_rate',
  {
    currency: text('currency').notNull(),
    asOf: isoDate('as_of').notNull(),
    rate: decimal('rate').notNull(),
    /** Where the rate came from; `frankfurter` is the only source (a mirror is still Frankfurter's answer). */
    source: text('source').notNull(),
    fetchedAt: epochMs('fetched_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.currency, table.asOf] })],
);

/**
 * A money account (DESIGN.md §6.1): a place money is held or owed, in **one currency, chosen when it is made and never changed**. `type` is one of the nine
 * (`bank`, `cash`, `savings`, `deposit`, `investment`, `property`, `credit_card`, `loan`, `person`). **Its balance is not a column:** it is the sum of its lines
 * (`src/ledger/balances.ts`). Made in task 4.2 because every line points at one; what a person can do with an account (make, edit, archive) is task 4.1.
 */
export const moneyAccount = sqliteTable(
  'money_account',
  {
    id: id('id'),
    bookId: ref('book_id').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    institution: text('institution'),
    currency: text('currency').notNull(),
    /** What a credit card may be used up to, in minor units of its currency (DESIGN.md §6.1). */
    creditLimit: money('credit_limit'),
    position: counter('position').notNull().default(0),
    archivedAt: epochMs('archived_at'),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [index('money_account_book_idx').on(table.bookId, table.position)],
);

/** A category (DESIGN.md §7.1), which groups subcategories and has the currency its budget is kept in. Made in task 4.2 for the lines that point at its subcategories; its screens are 5.1. */
export const category = sqliteTable(
  'category',
  {
    id: id('id'),
    bookId: ref('book_id').notNull(),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    position: counter('position').notNull().default(0),
    archivedAt: epochMs('archived_at'),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('category_book_idx').on(table.bookId, table.position)],
);

/** A subcategory: what an expense is spent on, and what a budget is set for (DESIGN.md §7.1). `budget_source` is `manual` or `bills` (task 6.4). */
export const subcategory = sqliteTable(
  'subcategory',
  {
    id: id('id'),
    bookId: ref('book_id').notNull(),
    categoryId: ref('category_id').notNull(),
    name: text('name').notNull(),
    budgetSource: text('budget_source').notNull().default('manual'),
    position: counter('position').notNull().default(0),
    archivedAt: epochMs('archived_at'),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('subcategory_category_idx').on(table.bookId, table.categoryId, table.position)],
);

/** Where income comes from (DESIGN.md §7.4): `primary` or `secondary`, in one currency. The lines of an income transaction point at one. */
export const incomeSource = sqliteTable(
  'income_source',
  {
    id: id('id'),
    bookId: ref('book_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    currency: text('currency').notNull(),
    archivedAt: epochMs('archived_at'),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('income_source_book_idx').on(table.bookId)],
);

/**
 * A transaction (DESIGN.md §6.2): a date with no time zone, a type, a status and the lines that say what moved. **Its lines add up to zero in its currency**,
 * except a transfer between two currencies, which records both amounts; that is held by the one write path (`src/ledger/transactions.ts`) and checked by
 * `src/ledger/invariants.ts`. `recurring_id` with `occurrence_date` is unique: a recurring entry posts an occurrence once (task 6.2). `payee_id` is task 4.5's.
 */
export const txn = sqliteTable(
  'txn',
  {
    id: id('id'),
    bookId: ref('book_id').notNull(),
    type: text('type').notNull(),
    date: isoDate('date').notNull(),
    payeeId: ref('payee_id'),
    note: text('note'),
    status: text('status').notNull(),
    recurringId: ref('recurring_id'),
    occurrenceDate: isoDate('occurrence_date'),
    /** What was charged in another currency, for information only (DESIGN.md §6.8). */
    originalAmount: money('original_amount'),
    originalCurrency: text('original_currency'),
    createdBy: ref('created_by').notNull(),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [
    index('txn_book_date_idx').on(table.bookId, table.date),
    index('txn_book_status_idx').on(table.bookId, table.status),
    uniqueIndex('txn_recurring_occurrence_idx').on(table.recurringId, table.occurrenceDate),
  ],
);

/**
 * A line of a transaction (DESIGN.md §6.3): **exactly one** of a money account, a subcategory, an income source or equity (`opening`, `adjustment`,
 * `revaluation`), with a signed amount in minor units of `currency`. A line on an account is positive when the account's balance goes up.
 */
export const txnLine = sqliteTable(
  'txn_line',
  {
    id: id('id'),
    bookId: ref('book_id').notNull(),
    txnId: ref('txn_id').notNull(),
    accountId: ref('account_id'),
    subcategoryId: ref('subcategory_id'),
    incomeSourceId: ref('income_source_id'),
    equity: text('equity'),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    position: counter('position').notNull(),
  },
  (table) => [
    index('txn_line_txn_idx').on(table.bookId, table.txnId),
    index('txn_line_account_idx').on(table.bookId, table.accountId),
    index('txn_line_subcategory_idx').on(table.bookId, table.subcategoryId),
    index('txn_line_income_source_idx').on(table.bookId, table.incomeSourceId),
  ],
);

/**
 * What a loan account adds to a money account (DESIGN.md §6.1, §8.3): who lent, how much, from when to when, what is paid each time, and the yearly rate as a
 * decimal string (never a float). `interest_subcategory_id` is where the interest of an instalment is spent. The currency is the account's.
 */
export const loan = sqliteTable('loan', {
  accountId: id('account_id'),
  bookId: ref('book_id').notNull(),
  lender: text('lender').notNull(),
  principal: money('principal').notNull(),
  startDate: isoDate('start_date').notNull(),
  endDate: isoDate('end_date').notNull(),
  instalment: money('instalment').notNull(),
  yearlyRate: decimal('yearly_rate'),
  interestSubcategoryId: ref('interest_subcategory_id'),
});
