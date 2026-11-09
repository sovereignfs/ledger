import { index, pgSchema, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { APP_STORE } from '../../config';
import { bool, counter, decimal, epochMs, id, isoDate, json, money, month, ref } from './columns';

/** The app's schema; better-auth's is `ledger_auth` (DESIGN.md §18.1). */
export const app = pgSchema(APP_STORE);

/** See `schema/sqlite/app.ts`. */
export const rateBucket = app.table(
  'rate_bucket',
  {
    key: id('key'),
    windowStart: epochMs('window_start').notNull(),
    count: counter('count').notNull(),
  },
  (table) => [index('rate_bucket_window_idx').on(table.windowStart)],
);

/** See `schema/sqlite/app.ts`. */
export const book = app.table('book', {
  id: id('id'),
  name: text('name').notNull(),
  baseCurrency: text('base_currency'),
  timeZone: text('time_zone').notNull().default('UTC'),
  firstDayOfWeek: counter('first_day_of_week').notNull().default(1),
  locale: text('locale'),
  recap: bool('recap').notNull().default(true),
  setupDoneAt: epochMs('setup_done_at'),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/** See `schema/sqlite/app.ts`. */
export const bookMember = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const bookCurrency = app.table(
  'book_currency',
  {
    bookId: ref('book_id').notNull(),
    code: text('code').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.code] })],
);

/** See `schema/sqlite/app.ts`. */
export const fxRate = app.table(
  'fx_rate',
  {
    currency: text('currency').notNull(),
    asOf: isoDate('as_of').notNull(),
    rate: decimal('rate').notNull(),
    source: text('source').notNull(),
    fetchedAt: epochMs('fetched_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.currency, table.asOf] })],
);

/** See `schema/sqlite/app.ts`. */
export const moneyAccount = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const category = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const subcategory = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const incomeSource = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const txn = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const txnLine = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const loan = app.table('loan', {
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

/** See `schema/sqlite/app.ts`. */
export const payee = app.table(
  'payee',
  {
    id: id('id'),
    bookId: ref('book_id').notNull(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    lastSubcategoryId: ref('last_subcategory_id'),
    lastAccountId: ref('last_account_id'),
    archivedAt: epochMs('archived_at'),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [uniqueIndex('payee_book_name_idx').on(table.bookId, table.nameKey)],
);

/** See `schema/sqlite/app.ts`. */
export const budgetAmount = app.table(
  'budget_amount',
  {
    bookId: ref('book_id').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: ref('target_id').notNull(),
    fromMonth: month('from_month').notNull(),
    amount: money('amount').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bookId, table.targetKind, table.targetId, table.fromMonth] }),
  ],
);

/** See `schema/sqlite/app.ts`. */
export const recurring = app.table(
  'recurring',
  {
    id: id('id'),
    bookId: ref('book_id').notNull(),
    template: json('template').notNull(),
    unit: text('unit').notNull(),
    every: counter('every').notNull(),
    anchorDate: isoDate('anchor_date').notNull(),
    endDate: isoDate('end_date'),
    mode: text('mode').notNull(),
    nextDate: isoDate('next_date'),
    loanAccountId: ref('loan_account_id'),
    endedAt: epochMs('ended_at'),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [
    index('recurring_next_idx').on(table.nextDate),
    index('recurring_book_idx').on(table.bookId),
  ],
);

/** See `schema/sqlite/app.ts`. */
export const recurringSkip = app.table(
  'recurring_skip',
  {
    recurringId: ref('recurring_id').notNull(),
    occurrenceDate: isoDate('occurrence_date').notNull(),
    bookId: ref('book_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.recurringId, table.occurrenceDate] })],
);
