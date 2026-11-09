import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbGet } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { type Book, ensureBook, findBook } from '../ledger/books';
import { BOOK_TABLES } from '../ledger/tables';
import { seedBook } from '../seed/seed';
import { FILE_TABLES, FORMAT, TABLES, VERSION, columnsOf, exportBook, fileColumns } from './format';

const { leg } = testTarget();

describe('the format holds every table of a book', () => {
  it('names exactly the tables that carry book_id: a new table fails here until it is in the file', () => {
    expect([...FILE_TABLES].sort()).toEqual([...BOOK_TABLES].sort());
    expect(new Set(FILE_TABLES).size).toBe(FILE_TABLES.length);
  });
});

describe(`what the format says of each table (${leg})`, () => {
  let t: TwoAccounts;
  beforeAll(async () => {
    t = await twoAccounts();
  });
  afterAll(async () => t.close());

  it('names only columns the table has, and points only at tables that come before it', () => {
    const seen = new Set<string>();
    for (const spec of TABLES) {
      const names = columnsOf(t.database, spec.table).map((column) => column.name);
      for (const column of [
        ...(spec.id ? [spec.id] : []),
        ...Object.keys(spec.refs),
        ...(spec.poly ? [spec.poly.column, spec.poly.kind] : []),
        ...(spec.person ?? []),
        ...(spec.template ? [spec.template] : []),
        ...spec.order,
      ])
        expect(names, `${spec.table}.${column}`).toContain(column);
      for (const target of [
        ...Object.values(spec.refs),
        ...Object.values(spec.poly?.targets ?? {}),
      ])
        expect(seen.has(target) || target === spec.table, `${spec.table} points at ${target}`).toBe(
          true,
        );
      seen.add(spec.table);
    }
  });

  it('leaves out of the file only the book’s own id and the people', () => {
    for (const spec of TABLES) {
      const all = columnsOf(t.database, spec.table).map((column) => column.name);
      const kept = fileColumns(t.database, spec).map((column) => column.name);
      expect(all.filter((name) => !kept.includes(name)).sort(), spec.table).toEqual(
        ['book_id', ...(spec.person ?? [])].sort(),
      );
    }
  });

  it('has an id column only where the table has its own key, and refs to no table that does not have one', () => {
    for (const spec of TABLES) {
      if (spec.id) expect(spec.id).toBe('id');
      for (const target of Object.values(spec.refs)) {
        const target_ = TABLES.find((each) => each.table === target);
        expect(target_?.id, `${spec.table} → ${target}`).toBe('id');
      }
    }
  });
});

describe(`the export of a book (${leg})`, () => {
  let t: TwoAccounts;
  let book: Book;
  let hers: Book;
  const NOW = new Date('2026-11-09T12:00:00Z');
  beforeAll(async () => {
    t = await twoAccounts();
    await ensureBook(t.database, t.ada.id);
    await ensureBook(t.database, t.grace.id);
    book = (await findBook(t.database, t.ada.id)) as Book;
    hers = (await findBook(t.database, t.grace.id)) as Book;
    await seedBook(t.database, t.ada.id, book.id, NOW);
    await seedBook(t.database, t.grace.id, hers.id, NOW);
  }, 180_000);
  afterAll(async () => t.close());

  const count = async (table: string, bookId: string) =>
    Number(
      (
        await dbGet<{ n: number | string }>(
          t.database,
          sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, table)} WHERE book_id = ${bookId}`,
        )
      )?.n,
    );

  it('holds every row of every table of the book and its settings, in a file that says what it is', async () => {
    const file = (await exportBook(t.database, t.ada.id, book.id, NOW.getTime())) as NonNullable<
      Awaited<ReturnType<typeof exportBook>>
    >;
    expect(file).toMatchObject({ format: FORMAT, version: VERSION, exportedAt: NOW.getTime() });
    expect(file.book).toMatchObject({ baseCurrency: 'USD', timeZone: 'UTC', recap: true });
    expect(file.book.setupDoneAt).not.toBeNull();
    expect(Object.keys(file.tables).sort()).toEqual([...BOOK_TABLES].sort());
    for (const table of BOOK_TABLES)
      expect(file.tables[table]?.length, table).toBe(await count(table, book.id));
    expect(file.tables.txn?.length ?? 0).toBeGreaterThan(250);
    // Nothing of a person in it, and the book's own id not either.
    const text = JSON.stringify(file);
    expect(text).not.toContain(t.ada.id);
    expect(text).not.toContain(book.id);
    expect(text).not.toContain(t.ada.email);
  });

  it('holds nothing of another book, and the rows are the values the database holds, as numbers and flags', async () => {
    const mine = (await exportBook(t.database, t.ada.id, book.id)) as NonNullable<
      Awaited<ReturnType<typeof exportBook>>
    >;
    const hersFile = (await exportBook(t.database, t.grace.id, hers.id)) as NonNullable<
      Awaited<ReturnType<typeof exportBook>>
    >;
    const mineIds = new Set(mine.tables.txn?.map((row) => row.id));
    expect(hersFile.tables.txn?.some((row) => mineIds.has(row.id))).toBe(false);
    for (const row of mine.tables.txn_line ?? []) {
      expect(typeof row.amount).toBe('number');
      expect(typeof row.position).toBe('number');
    }
    expect(typeof mine.book.recap).toBe('boolean');
    // Asked for by the wrong person, or for the wrong book: nothing.
    expect(await exportBook(t.database, t.grace.id, book.id)).toBeUndefined();
    expect(await exportBook(t.database, t.ada.id, hers.id)).toBeUndefined();
  });

  it('is the same file when asked twice, in the same order', async () => {
    const a = await exportBook(t.database, t.ada.id, book.id, 1);
    const b = await exportBook(t.database, t.ada.id, book.id, 1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
