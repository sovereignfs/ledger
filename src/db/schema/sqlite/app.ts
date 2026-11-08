import { index, sqliteTable } from 'drizzle-orm/sqlite-core';
import { counter, epochMs, id } from './columns';

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
