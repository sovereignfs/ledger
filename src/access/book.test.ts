import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { makeStore } from '../db/test-store';
import { testTarget } from '../db/test-support';
import { bookTable, ensureBook } from '../ledger/books';
import { inBook } from './book';

const { leg } = testTarget();

let database: Database;
let close: () => Promise<void>;
let ada: string;
let grace: string;
let adasBook: string;
let gracesBook: string;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  ada = crypto.randomUUID();
  grace = crypto.randomUUID();
  adasBook = (await ensureBook(database, ada)).id;
  gracesBook = (await ensureBook(database, grace)).id;
});
afterAll(async () => close());

/** The books a statement finds for an account, through the membership condition that every statement on a book's rows carries. */
async function visibleTo(accountId: string): Promise<string[]> {
  const rows = await dbAll<{ id: string }>(
    database,
    sql`SELECT b.id AS id FROM ${bookTable(database)} b WHERE ${inBook(database, sql`b.id`, accountId)} ORDER BY b.id`,
  );
  return rows.map((row) => row.id);
}

describe(`membership as a condition of the statement (${leg})`, () => {
  it('finds a person’s own book and not another’s', async () => {
    expect(await visibleTo(ada)).toEqual([adasBook]);
    expect(await visibleTo(grace)).toEqual([gracesBook]);
  });

  it('finds nothing for someone with no book, and for an id that is not an account, so that "not mine" and "not there" read alike', async () => {
    expect(await visibleTo(crypto.randomUUID())).toEqual([]);
    expect(await visibleTo('')).toEqual([]);
  });

  it('is a condition of the same statement, so that the answer cannot change between a check and a touch: it compares one book with one account in the row it reads', async () => {
    const rows = await dbAll<{ id: string }>(
      database,
      sql`SELECT b.id AS id FROM ${bookTable(database)} b WHERE b.id = ${gracesBook} AND ${inBook(database, sql`b.id`, ada)}`,
    );
    // Asking for grace's book by its id, as ada, finds nothing: the same answer as for an id that was never made.
    expect(rows).toEqual([]);
    const never = await dbAll<{ id: string }>(
      database,
      sql`SELECT b.id AS id FROM ${bookTable(database)} b WHERE b.id = ${crypto.randomUUID()} AND ${inBook(database, sql`b.id`, ada)}`,
    );
    expect(never).toEqual(rows);
  });

  it('is not fooled by what an account id looks like: a value is bound, never joined into the statement', async () => {
    const hostile = `${ada}' OR '1'='1`;
    expect(await visibleTo(hostile)).toEqual([]);
  });
});
