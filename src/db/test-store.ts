import type { Database } from './client';
import { openDatabase } from './client';
import { runMigrations } from './migrate';
import { freshDatabase, testTarget } from './test-support';

/**
 * What the tests of the data layer share: a migrated app store, started from empty. It resets **both** stores, as `freshDatabase` does, so a test that
 * needs sessions and the app's tables makes the accounts first (`src/access/two-accounts.ts`) and then opens the store beside them, not reset.
 */
export async function makeStore(): Promise<{ database: Database; close(): Promise<void> }> {
  const { database } = await freshDatabase('app');
  await runMigrations(database);
  return { database, close: () => database.close() };
}

/**
 * The app's store beside an auth store that is already there, migrated, and **not reset**. `makeStore()` would take the sessions away on sqld and
 * PostgreSQL, where the stores are shared (a `file:` database has a file each, which is why that leg alone would not show it).
 */
export async function openStoreBesideAuth(): Promise<{
  database: Database;
  close(): Promise<void>;
}> {
  const database = await openDatabase(testTarget().config, 'app');
  await runMigrations(database);
  return { database, close: () => database.close() };
}
