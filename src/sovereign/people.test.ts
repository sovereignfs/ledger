import { getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as sqliteSchema from '../db/schema/sqlite';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { bookIdFor, ensureBook, memberTable } from '../ledger/books';
import { setBudget } from '../budget/amounts';
import { createAccount } from '../ledger/accounts';
import { addCurrency } from '../ledger/currencies';
import { seedAccount, seedIncomeSource, seedSubcategory } from '../ledger/testing';
import { createTransaction } from '../ledger/transactions';
import { createJar, moveMoney } from '../jars/jars';
import { createRecurring } from '../recurring/recurring';
import type { TxnInput } from '../ledger/validate';
import { BOOK_TABLES } from '../ledger/tables';
import { RateLimiter } from '../limits/rate';
import { deletePerson } from './people';

/**
 * Deleting an account (DESIGN.md §17), on two real accounts and every table. **The test that keeps the routine whole:** it asks the schema for its tables, and a
 * table that is in none of the lists below fails it, so a new table that holds something of a person cannot be added without deciding what becomes of it. Then
 * it seeds a row of each kind for the person and for a second person, runs the routine (twice), and finds nothing of the first and everything of the second.
 */
const { leg } = testTarget();

/** Tables whose rows are the person's, and are deleted by the routine by name. */
const GOES = ['rate_bucket', 'user', 'two_factor', 'passkey', 'session', 'account', 'verification'];
/** The book's own tables, and every table that carries `book_id` (`BOOK_TABLES`): deleted with a book that has no one else in it. */
const THE_BOOK = ['book', 'book_member', ...BOOK_TABLES];
/** Tables that are about something else than a person: better-auth's own limits, and the instance's exchange rates (`fx_rate`, no `book_id`, nobody's). */
const NOT_A_PERSON = ['rate_limit', 'fx_rate'];

let t: TwoAccounts;
let database: Database;
beforeAll(async () => {
  t = await twoAccounts();
  database = t.database;
});
afterAll(async () => t.close());

const NOW = 1_800_000_000_000;
const id = () => crypto.randomUUID();
const deps = () => ({ database, authDatabase: t.auth.database, now: () => NOW });

const count = async (db: Database, table: string, where: ReturnType<typeof sql>): Promise<number> =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        db,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(db, table)} WHERE ${where}`,
      )
    )[0]?.n ?? 0,
  );
/** A time as the sign-in store holds it: a date on PostgreSQL, milliseconds in SQLite. */
const authTime = (ms: number): Date | number =>
  t.auth.database.dialect === 'postgres' ? new Date(ms) : ms;

describe(`the tables (${leg})`, () => {
  it('are each decided: they go with the person, they are a book’s, or they are not about a person', () => {
    const names = Object.values(sqliteSchema)
      .filter((each) => is(each, SQLiteTable))
      .map((each) => getTableName(each as SQLiteTable));
    expect(names.length).toBeGreaterThan(8);
    const decided = new Set([...GOES, ...THE_BOOK, ...NOT_A_PERSON]);
    expect(
      names.filter((name) => !decided.has(name)),
      'a table nobody decided about',
    ).toEqual([]);
    expect(
      [...decided].filter((name) => !names.includes(name)),
      'a table that is not there',
    ).toEqual([]);
  });

  it('name no table twice, and every book table is one the routine can find', () => {
    expect(new Set(BOOK_TABLES).size).toBe(BOOK_TABLES.length);
    for (const name of BOOK_TABLES) expect(() => tableNamed(database, name)).not.toThrow();
  });
});

describe(`deleting a person (${leg})`, () => {
  it('leaves nothing of them, and the other person whole, and can be run again', async () => {
    const [ada, grace] = [t.ada.id, t.grace.id];
    for (const who of [ada, grace]) {
      await ensureBook(database, who, NOW);
      await new RateLimiter(database).take(`sign-in:${who}`, { limit: 10, windowMs: 60_000 });
    }
    await dbAll(
      t.auth.database,
      sql`INSERT INTO ${tableNamed(t.auth.database, 'verification')} (id, identifier, value, expires_at, created_at, updated_at)
          VALUES (${id()}, ${t.ada.email}, 'x', ${authTime(NOW)}, ${authTime(NOW)}, ${authTime(NOW)}) RETURNING id`,
    );
    for (const [who, tf, pk] of [
      [ada, 'tf-ada', 'pk-ada'],
      [grace, 'tf-grace', 'pk-grace'],
    ] as const) {
      await dbAll(
        t.auth.database,
        sql`INSERT INTO ${tableNamed(t.auth.database, 'two_factor')} (id, secret, backup_codes, user_id) VALUES (${tf}, 's', 'b', ${who}) RETURNING id`,
      );
      await dbAll(
        t.auth.database,
        sql`INSERT INTO ${tableNamed(t.auth.database, 'passkey')} (id, public_key, user_id, credential_id, counter, device_type, backed_up)
            VALUES (${pk}, 'k', ${who}, ${`c-${pk}`}, 0, 'singleDevice', ${t.auth.database.dialect === 'postgres' ? false : 0}) RETURNING id`,
      );
    }
    // One row of every table of a book, for each of them, made by the code that makes them: a table that is added and not seeded here fails below.
    for (const who of [ada, grace]) {
      const book = bookIdFor(who);
      const bank = await seedAccount(database, book, 'USD');
      const cash = await seedAccount(database, book, 'USD', 'cash');
      const food = await seedSubcategory(database, book);
      const pay = await seedIncomeSource(database, book);
      await addCurrency(database, who, book, 'EUR');
      expect(
        (
          await setBudget(database, who, book, {
            kind: 'subcategory',
            targetId: food,
            amount: 40_000,
            when: 'this',
            currentMonth: '2026-11',
          })
        ).ok,
      ).toBe(true);
      const loan = await createAccount(database, who, book, {
        type: 'loan',
        name: 'Loan',
        currency: 'USD',
        opening: { amount: -9000, date: '2026-01-01' },
        loan: {
          lender: 'Lender',
          principal: 9000,
          startDate: '2026-01-01',
          endDate: '2027-01-01',
          instalment: 900,
          yearlyRate: '4.5',
          interestSubcategoryId: null,
        },
      });
      expect(loan.ok).toBe(true);
      // A jar in a savings account, with something earmarked in it.
      const savings = await createAccount(database, who, book, {
        type: 'savings',
        name: 'Savings',
        currency: 'USD',
        opening: { amount: 10_000, date: '2026-01-01' },
      });
      if (!savings.ok) throw new Error('savings not made');
      const jar = await createJar(
        database,
        who,
        book,
        { accountId: savings.id, name: 'Trip', monthly: 100 },
        '2026-11',
      );
      if (!jar.ok) throw new Error('jar not made');
      expect(
        (
          await moveMoney(database, who, book, jar.id, {
            direction: 'earmark',
            amount: 100,
            date: '2026-11-02',
          })
        ).ok,
      ).toBe(true);
      // A recurring entry, and an occurrence of it the person skipped.
      const repeating = await createRecurring(database, who, book, {
        template: {
          type: 'expense',
          lines: [
            { account: bank, amount: -700, currency: 'USD' },
            { subcategory: food, amount: 700, currency: 'USD' },
          ],
          payee: 'Landlord',
          note: null,
        },
        unit: 'month',
        every: 1,
        anchor: '2099-01-01',
        mode: 'confirm',
      });
      expect(repeating.ok).toBe(true);
      if (repeating.ok)
        await dbAll(
          database,
          sql`INSERT INTO ${tableNamed(database, 'recurring_skip')} (recurring_id, occurrence_date, book_id)
              VALUES (${repeating.id}, '2099-01-01', ${book}) RETURNING recurring_id`,
        );
      const entries: [TxnInput['type'], TxnInput['lines']][] = [
        [
          'expense',
          [
            { account: bank, amount: -500, currency: 'USD' },
            { subcategory: food, amount: 500, currency: 'USD' },
          ],
        ],
        [
          'income',
          [
            { account: bank, amount: 9000, currency: 'USD' },
            { incomeSource: pay, amount: -9000, currency: 'USD' },
          ],
        ],
        [
          'transfer',
          [
            { account: bank, amount: -100, currency: 'USD' },
            { account: cash, amount: 100, currency: 'USD' },
          ],
        ],
      ];
      for (const [type, lines] of entries)
        expect(
          (
            await createTransaction(database, who, book, {
              type,
              date: '2026-11-06',
              payee: 'Shop',
              lines,
            })
          ).ok,
        ).toBe(true);
    }
    const inBookCount = (who: string, name: string) =>
      count(database, name, sql`book_id = ${bookIdFor(who)}`);
    for (const name of BOOK_TABLES) {
      expect(await inBookCount(ada, name), `${name} of ada, seeded`).toBeGreaterThan(0);
      expect(await inBookCount(grace, name), `${name} of grace, seeded`).toBeGreaterThan(0);
    }
    const graces = Object.fromEntries(
      await Promise.all(
        BOOK_TABLES.map(async (name) => [name, await inBookCount(grace, name)] as const),
      ),
    );
    // Both have a session from signing up, and a sign-in, and a book.
    expect(await count(t.auth.database, 'session', sql`user_id = ${ada}`)).toBeGreaterThan(0);

    const result = await deletePerson(deps(), ada);
    expect(result).toEqual({ booksDeleted: 1, booksLeft: 0 });

    const mineGone = async (db: Database, table: string, column: string, value: string) =>
      count(db, table, sql`${sql.raw(column)} = ${value}`);
    for (const [table, column] of [
      ['user', 'id'],
      ['session', 'user_id'],
      ['account', 'user_id'],
      ['two_factor', 'user_id'],
      ['passkey', 'user_id'],
    ] as const)
      expect(await mineGone(t.auth.database, table, column, ada), `${table} of ada`).toBe(0);
    expect(await count(t.auth.database, 'verification', sql`identifier = ${t.ada.email}`)).toBe(0);
    expect(await mineGone(database, 'book_member', 'account_id', ada)).toBe(0);
    expect(await mineGone(database, 'book', 'id', bookIdFor(ada))).toBe(0);
    expect(await count(database, 'rate_bucket', sql`"key" LIKE ${`%:${ada}`}`)).toBe(0);

    for (const name of BOOK_TABLES) {
      expect(await inBookCount(ada, name), `${name} of ada, after`).toBe(0);
      expect(await inBookCount(grace, name), `${name} of grace, after`).toBe(graces[name]);
    }

    // The other person is whole.
    for (const [table, column] of [
      ['user', 'id'],
      ['session', 'user_id'],
      ['account', 'user_id'],
      ['two_factor', 'user_id'],
      ['passkey', 'user_id'],
    ] as const)
      expect(
        await mineGone(t.auth.database, table, column, grace),
        `${table} of grace`,
      ).toBeGreaterThan(0);
    expect(await mineGone(database, 'book_member', 'account_id', grace)).toBe(1);
    expect(await mineGone(database, 'book', 'id', bookIdFor(grace))).toBe(1);
    expect(await count(database, 'rate_bucket', sql`"key" LIKE ${`%:${grace}`}`)).toBe(1);

    // Safe to run again, and still the same.
    expect(await deletePerson(deps(), ada)).toEqual({ booksDeleted: 0, booksLeft: 0 });
    expect(await mineGone(database, 'book', 'id', bookIdFor(grace))).toBe(1);
  });

  it('takes a person out of a book that has someone else in it, and leaves the book to them', async () => {
    const owner = id();
    const guest = id();
    const book = (await ensureBook(database, owner, NOW)).id;
    // Phase 1 makes no second member; this is the shape phase 2 would give (DESIGN.md §5.3), made by hand.
    await dbAll(
      database,
      sql`INSERT INTO ${memberTable(database)} (book_id, account_id, role, created_at) VALUES (${book}, ${guest}, 'member', ${NOW}) RETURNING book_id`,
    );
    const result = await deletePerson(deps(), owner);
    expect(result).toEqual({ booksDeleted: 0, booksLeft: 1 });
    const left = await dbGet<{ n: number | string }>(
      database,
      sql`SELECT COUNT(*) AS n FROM ${memberTable(database)} WHERE book_id = ${book}`,
    );
    expect(Number(left?.n)).toBe(1);
    expect(await count(database, 'book', sql`id = ${book}`)).toBe(1);
    expect(await count(database, 'book_member', sql`account_id = ${owner}`)).toBe(0);
  });
});
