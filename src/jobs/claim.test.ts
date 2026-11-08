import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Database, openDatabase } from './../db/client';
import { dbGet, dbRun } from './../db/exec';
import { freshDatabase, testTarget } from './../db/test-support';
import { claim } from './claim';

const { leg } = testTarget();
let first: Database;
/** A second connection, as a second process has. */
let second: Database;

beforeAll(async () => {
  const fresh = await freshDatabase();
  first = fresh.database;
  second = await openDatabase(fresh.config);
  await dbRun(first, sql`DROP TABLE IF EXISTS claim_probe`);
  await dbRun(first, sql`CREATE TABLE claim_probe (id TEXT PRIMARY KEY, done_on TEXT)`);
});

afterAll(async () => {
  await dbRun(first, sql`DROP TABLE IF EXISTS claim_probe`);
  await Promise.all([first.close(), second.close()]);
});

/** The statement a job writes: free while `done_on` is empty or before today. */
const take = (id: string, today: string) =>
  sql`UPDATE claim_probe SET done_on = ${today} WHERE id = ${id} AND (done_on IS NULL OR done_on < ${today}) RETURNING id`;

describe(`claiming a piece of work (${leg})`, () => {
  it('is won by the process whose update changed the row, and by no one else', async () => {
    await dbRun(first, sql`INSERT INTO claim_probe (id) VALUES ('digest')`);
    expect(await claim(first, take('digest', '2026-11-05'))).toBe(true);
    expect(await claim(second, take('digest', '2026-11-05'))).toBe(false);
    expect(await claim(first, take('digest', '2026-11-05'))).toBe(false);
  });

  it('is won by exactly one of several that try at once, from different connections', async () => {
    for (let round = 0; round < 10; round++) {
      const id = `race-${round}`;
      await dbRun(first, sql`INSERT INTO claim_probe (id) VALUES (${id})`);
      const results = await Promise.all([
        claim(first, take(id, '2026-11-05')),
        claim(second, take(id, '2026-11-05')),
        claim(first, take(id, '2026-11-05')),
        claim(second, take(id, '2026-11-05')),
      ]);
      expect(results.filter(Boolean), `round ${round}`).toHaveLength(1);
    }
  });

  it('is free again when the thing that made it due is true again, as on the next day', async () => {
    await dbRun(first, sql`INSERT INTO claim_probe (id) VALUES ('daily')`);
    expect(await claim(first, take('daily', '2026-11-05'))).toBe(true);
    expect(await claim(second, take('daily', '2026-11-06'))).toBe(true);
    expect(await claim(first, take('daily', '2026-11-06'))).toBe(false);
  });

  it('is not won for a row that is not there, or that is not due', async () => {
    expect(await claim(first, take('nothing', '2026-11-05'))).toBe(false);
  });

  it('changes only the row it claimed', async () => {
    await dbRun(first, sql`INSERT INTO claim_probe (id) VALUES ('mine'), ('yours')`);
    await claim(first, take('mine', '2026-11-05'));
    expect(await dbGet(first, sql`SELECT done_on FROM claim_probe WHERE id = 'yours'`)).toEqual({
      done_on: null,
    });
  });
});
