import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { testTarget } from '../db/test-support';
import { makeStore } from '../db/test-store';
import { bookIdFor, bookTable, ensureBook, findBook, memberTable } from './books';

const { leg } = testTarget();

let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const account = () => crypto.randomUUID();

describe(`a person's book (${leg})`, () => {
  it('is made at the first request, with the person as its owner and nothing chosen yet', async () => {
    const id = account();
    expect(await findBook(database, id)).toBeUndefined();
    const book = await ensureBook(database, id, 1_800_000_000_000);
    expect(book).toEqual({
      id: bookIdFor(id),
      name: 'My budget',
      baseCurrency: null,
      timeZone: 'UTC',
      firstDayOfWeek: 1,
      locale: null,
      recap: true,
      setupDoneAt: null,
    });
    const member = await dbGet<{ role: string; createdAt: number }>(
      database,
      sql`SELECT role, created_at AS "createdAt" FROM ${memberTable(database)} WHERE book_id = ${book.id} AND account_id = ${id}`,
    );
    expect(member).toEqual({ role: 'owner', createdAt: 1_800_000_000_000 });
  });

  it('is the same book the next time, and is made once however many ask at the same moment', async () => {
    const id = account();
    const [a, b, c, d] = await Promise.all([
      ensureBook(database, id),
      ensureBook(database, id),
      ensureBook(database, id),
      ensureBook(database, id),
    ]);
    expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(1);
    expect((await ensureBook(database, id)).id).toBe(a.id);
    const books = await dbAll(
      database,
      sql`SELECT id FROM ${bookTable(database)} WHERE id = ${bookIdFor(id)}`,
    );
    const members = await dbAll(
      database,
      sql`SELECT account_id FROM ${memberTable(database)} WHERE account_id = ${id}`,
    );
    expect([books.length, members.length]).toEqual([1, 1]);
  });

  it('is each person’s own: two people have two books, and neither finds the other’s', async () => {
    const ada = account();
    const grace = account();
    const adas = await ensureBook(database, ada);
    const graces = await ensureBook(database, grace);
    expect(adas.id).not.toBe(graces.id);
    expect((await findBook(database, ada))?.id).toBe(adas.id);
    expect((await findBook(database, grace))?.id).toBe(graces.id);
  });

  it('has an id made from the account’s, and not from anything a request could say', () => {
    expect(bookIdFor('a')).toBe(bookIdFor('a'));
    expect(bookIdFor('a')).not.toBe(bookIdFor('b'));
  });
});
