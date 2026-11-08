import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { bool, counter, epochMs, id, ref } from './columns';

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
