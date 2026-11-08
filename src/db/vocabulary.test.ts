import { sql } from 'drizzle-orm';
import { pgSchema } from 'drizzle-orm/pg-core';
import { sqliteTable } from 'drizzle-orm/sqlite-core';
import {
  generateDrizzleJson,
  generateMigration,
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './client';
import { assertMinor } from '../money/amount';
import { dbAll, dbGet, dbRun } from './exec';
import * as pgColumns from './schema/postgres/columns';
import * as sqliteColumns from './schema/sqlite/columns';
import { freshDatabase, testTarget } from './test-support';

/**
 * The column vocabulary (DESIGN.md §18.2) is only worth anything if each word means the same thing on both dialects, so this makes a table
 * out of every word, with the SQL the generator really writes for it, and reads values back through each. The tables are the test's own and
 * are dropped afterwards; the app's schema is not touched.
 */
const { leg } = testTarget();

/** A schema of the test's own in PostgreSQL, so that dropping it cannot reach anything else. */
const probeSchema = pgSchema('ledger_probe');

const sqliteProbe = sqliteTable('vocabulary_probe', {
  id: sqliteColumns.id('id'),
  owner: sqliteColumns.ref('owner').notNull(),
  at: sqliteColumns.epochMs('at').notNull(),
  seq: sqliteColumns.counter('seq').notNull(),
  amount: sqliteColumns.money('amount').notNull(),
  done: sqliteColumns.bool('done').notNull(),
  day: sqliteColumns.isoDate('day'),
  period: sqliteColumns.month('period'),
  rate: sqliteColumns.decimal('rate'),
  data: sqliteColumns.json('data').notNull(),
});

const pgProbe = probeSchema.table('vocabulary_probe', {
  id: pgColumns.id('id'),
  owner: pgColumns.ref('owner').notNull(),
  at: pgColumns.epochMs('at').notNull(),
  seq: pgColumns.counter('seq').notNull(),
  amount: pgColumns.money('amount').notNull(),
  done: pgColumns.bool('done').notNull(),
  day: pgColumns.isoDate('day'),
  period: pgColumns.month('period'),
  rate: pgColumns.decimal('rate'),
  data: pgColumns.json('data').notNull(),
});

/** The statements the generator writes to make the probe, as the migrations of the app are made. */
async function createStatements(dialect: Database['dialect']): Promise<string[]> {
  if (dialect === 'sqlite') {
    return generateSQLiteMigration(
      await generateSQLiteDrizzleJson({}),
      await generateSQLiteDrizzleJson({ sqliteProbe }),
    );
  }
  return generateMigration(
    await generateDrizzleJson({}),
    await generateDrizzleJson({ probeSchema, pgProbe }),
  );
}

let database: Database;
let table: ReturnType<typeof sql.raw>;

beforeAll(async () => {
  ({ database } = await freshDatabase());
  table =
    database.dialect === 'postgres'
      ? sql.raw('"ledger_probe"."vocabulary_probe"')
      : sql.raw('"vocabulary_probe"');
  if (database.dialect === 'postgres') {
    await dbRun(database, sql`DROP SCHEMA IF EXISTS ledger_probe CASCADE`);
  }
  for (const statement of await createStatements(database.dialect)) {
    await dbRun(database, sql.raw(statement));
  }
});

afterAll(async () => {
  if (database.dialect === 'postgres') {
    await dbRun(database, sql`DROP SCHEMA IF EXISTS ledger_probe CASCADE`);
  }
  await database.close();
});

/** Inserts a row with every required column, and the optional ones given. */
async function insert(
  id: string,
  values: { at?: number; seq?: number; amount?: number; done?: boolean; data?: string } = {},
  optional: { day?: string; period?: string; rate?: string } = {},
) {
  await dbRun(
    database,
    sql`INSERT INTO ${table} (id, owner, at, seq, amount, done, day, period, rate, data)
        VALUES (${id}, 'a', ${values.at ?? 1}, ${values.seq ?? 1}, ${values.amount ?? 0}, ${values.done ?? false},
                ${optional.day ?? null}, ${optional.period ?? null}, ${optional.rate ?? null}, ${values.data ?? '{}'})`,
  );
}

describe(`the column vocabulary (${leg})`, () => {
  it('stores a time, a counter and an amount as numbers, exactly, past 2^32', async () => {
    const at = 1_800_000_000_123;
    const seq = 5_000_000_000;
    // 90 trillion minor units: more than anyone holds, and a number JavaScript still keeps exactly.
    const amount = -90_000_000_000_000;
    await insert('t1', { at, seq, amount, done: true });
    const row = await dbGet<{ at: unknown; seq: unknown; amount: unknown }>(
      database,
      sql`SELECT at, seq, amount FROM ${table} WHERE id = 't1'`,
    );
    expect(row).toEqual({ at, seq, amount });
    expect(typeof row?.at).toBe('number');
    expect(typeof row?.seq).toBe('number');
    expect(typeof row?.amount).toBe('number');
  });

  it('sums amounts exactly, as a balance is a sum', async () => {
    await insert('m1', { amount: 1_000_000_000_001 });
    await insert('m2', { amount: -1 });
    await insert('m3', { amount: 2 });
    const row = await dbGet<{ total: unknown }>(
      database,
      sql`SELECT SUM(amount) AS total FROM ${table} WHERE id LIKE 'm%'`,
    );
    // PostgreSQL returns a bigint sum as text, which `exec.ts` does not reshape for raw SQL; a query casts where it matters.
    expect(Number(row?.total)).toBe(1_000_000_000_002);
  });

  it('stores a boolean that can be read back as true and false', async () => {
    await insert('b1', { done: true });
    await insert('b2', { done: false });
    const rows = await dbAll<{ id: string; done: unknown }>(
      database,
      sql`SELECT id, done FROM ${table} WHERE id IN ('b1', 'b2') ORDER BY id`,
    );
    // SQLite returns 0 and 1 where PostgreSQL returns booleans: raw reads cast where it matters (exec.ts), and a query says `done = ...`.
    expect(rows.map((r) => [r.id, Boolean(r.done)])).toEqual([
      ['b1', true],
      ['b2', false],
    ]);
  });

  it('keeps a date and a month as the text it was given, and they sort as dates and months', async () => {
    for (const [id, day, period] of [
      ['d3', '2026-11-30', '2026-11'],
      ['d1', '2025-12-01', '2025-12'],
      ['d2', '2026-02-04', '2026-02'],
    ] as const) {
      await insert(id, {}, { day, period });
    }
    const byDay = await dbAll<{ id: string; day: string; period: string }>(
      database,
      sql`SELECT id, day, period FROM ${table} WHERE id LIKE 'd%' ORDER BY day`,
    );
    expect(byDay.map((r) => r.id)).toEqual(['d1', 'd2', 'd3']);
    expect(byDay[2]).toMatchObject({ day: '2026-11-30', period: '2026-11' });
    const byMonth = await dbAll<{ id: string }>(
      database,
      sql`SELECT id FROM ${table} WHERE id LIKE 'd%' ORDER BY period`,
    );
    expect(byMonth.map((r) => r.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('keeps a rate as the decimal text it was given, never a float', async () => {
    const rate = '0.1234567890123456789';
    await insert('r1', {}, { rate });
    expect(
      await dbGet<{ rate: string }>(database, sql`SELECT rate FROM ${table} WHERE id = 'r1'`),
    ).toEqual({ rate });
  });

  it('keeps JSON text exactly, without reformatting it', async () => {
    const data = '{"type":"expense","lines":[{"account":"a","amount":-340}]}';
    await insert('j1', { data });
    expect(
      await dbGet<{ data: string }>(database, sql`SELECT data FROM ${table} WHERE id = 'j1'`),
    ).toEqual({ data });
  });

  it('is written only after `assertMinor`, so a float never reaches the column: it is refused, and nothing is stored', async () => {
    for (const bad of [12.5, 0.1 + 0.2, NaN, 2 ** 60]) {
      const id = `float-${String(bad)}`;
      await expect(
        (async () => {
          assertMinor(bad);
          await insert(id, { amount: bad });
        })(),
        String(bad),
      ).rejects.toThrow(/whole number/);
      expect(
        await dbAll(database, sql`SELECT id FROM ${table} WHERE id = ${id}`),
        `${bad} stored`,
      ).toEqual([]);
    }
  });

  it('has a primary key on the id', async () => {
    await insert('p1');
    await expect(insert('p1')).rejects.toThrow();
  });
});

describe('the generated SQL', () => {
  it('makes an amount a 64-bit integer on both dialects, and never a float', async () => {
    const pg = (await createStatements('postgres')).join('\n');
    const lite = (await createStatements('sqlite')).join('\n');
    expect(pg).toContain('"amount" bigint NOT NULL');
    expect(lite).toContain('`amount` integer NOT NULL');
    expect(pg + lite).not.toMatch(/real|double|float|numeric/i);
  });
});
