import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { tableNamed } from '../db/tables';
import { bookTable, memberTable } from '../ledger/books';
import { BOOK_TABLES } from '../ledger/tables';

/**
 * **Everything of an account is deleted by this, and only this** (DESIGN.md §17). One routine, in a fixed order, **safe to run again**: the two stores (the
 * app's and the sign-in store) cannot share a transaction, so a run that stopped part way is finished by running it again, and the row that makes the
 * account findable (the account itself) goes **last**, so that a run that stopped can still find it.
 *
 *  1. Their books. A book of which they are the only member goes with every row of it, by `book_id` (`BOOK_TABLES`), in one transaction. A book with other
 *     members (phase 2) is left to them, and the person is taken out of it.
 *  2. What was kept for them in the app's store: the counters of rate limits, keyed `kind:account`.
 *  3. The sign-in store: sessions, sign-ins (the password, and later a Sovereign identity), second factors, passkeys, pending verifications, and then the
 *     account.
 *
 * `people.test.ts` seeds a row in every table for the person and for a second person, finds nothing of the first after, and the second's intact, and fails for
 * a table that is in none of its lists: **a new table that holds something of a person is deleted here**, by being a book's table or by being named in the
 * routine.
 */
export interface PeopleDeps {
  /** The app's store. */
  readonly database: Database;
  /** The sign-in store (the same database as the app's, or another). */
  readonly authDatabase: Database;
  readonly now: () => number;
}

export interface Deleted {
  /** Books that went with the person, being theirs alone. */
  readonly booksDeleted: number;
  /** Books that carry on for the other people in them. */
  readonly booksLeft: number;
}

export async function deletePerson(deps: PeopleDeps, accountId: string): Promise<Deleted> {
  const { database, authDatabase } = deps;
  const members = memberTable(database);
  const books = bookTable(database);

  // 1. Their books, each in a transaction of its own.
  const mine = await dbAll<{ bookId: string }>(
    database,
    sql`SELECT book_id AS "bookId" FROM ${members} WHERE account_id = ${accountId}`,
  );
  let booksDeleted = 0;
  let booksLeft = 0;
  for (const { bookId } of mine) {
    const alone = await transaction(database, async (tx) => {
      // Alone, decided in the statement that deletes: the book's own row goes only if no one else is a member of it, and what that returns is the answer.
      const gone = await dbAll<{ id: string }>(
        tx,
        sql`DELETE FROM ${books}
             WHERE id = ${bookId}
               AND NOT EXISTS (SELECT 1 FROM ${members} m WHERE m.book_id = ${bookId} AND m.account_id <> ${accountId})
         RETURNING id`,
      );
      if (gone.length === 0) {
        await dbAll(
          tx,
          sql`DELETE FROM ${members} WHERE book_id = ${bookId} AND account_id = ${accountId} RETURNING book_id`,
        );
        return false;
      }
      for (const name of BOOK_TABLES)
        await dbAll(
          tx,
          sql`DELETE FROM ${tableNamed(tx, name)} WHERE book_id = ${bookId} RETURNING book_id`,
        );
      await dbAll(tx, sql`DELETE FROM ${members} WHERE book_id = ${bookId} RETURNING book_id`);
      return true;
    });
    if (alone) booksDeleted++;
    else booksLeft++;
  }

  // 2. What was kept for them in the app's store. Counters are keyed `kind:account`.
  const app = database.dialect === 'postgres' ? postgresSchema : sqliteSchema;
  await dbAll(
    database,
    sql`DELETE FROM ${app.rateBucket} WHERE "key" LIKE ${`%:${accountId}`} RETURNING "key"`,
  );

  // 3. The sign-in store. The address is read first, for the verifications that are named by it; the account goes last.
  const auth = authDatabase.dialect === 'postgres' ? postgresSchema : sqliteSchema;
  const user = await dbGet<{ email: string }>(
    authDatabase,
    sql`SELECT email FROM ${auth.user} WHERE id = ${accountId}`,
  );
  await dbAll(
    authDatabase,
    sql`DELETE FROM ${auth.session} WHERE user_id = ${accountId} RETURNING id`,
  );
  await dbAll(
    authDatabase,
    sql`DELETE FROM ${auth.account} WHERE user_id = ${accountId} RETURNING id`,
  );
  // Second factors and passkeys, before the account they belong to, by name and not by what the store cascades.
  await dbAll(
    authDatabase,
    sql`DELETE FROM ${auth.twoFactor} WHERE user_id = ${accountId} RETURNING id`,
  );
  await dbAll(
    authDatabase,
    sql`DELETE FROM ${auth.passkey} WHERE user_id = ${accountId} RETURNING id`,
  );
  if (user)
    await dbAll(
      authDatabase,
      sql`DELETE FROM ${auth.verification} WHERE LOWER(identifier) = ${user.email.toLowerCase()} RETURNING id`,
    );
  await dbAll(authDatabase, sql`DELETE FROM ${auth.user} WHERE id = ${accountId} RETURNING id`);

  return { booksDeleted, booksLeft };
}
