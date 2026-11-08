import { index, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';
import { APP_STORE } from '../../config';
import { bool, counter, epochMs, id, ref } from './columns';

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
