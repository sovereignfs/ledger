import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { bulkDelete, bulkRecategorise, bulkSetStatus } from './bulk';
import { ensureBook } from './books';
import { getEntry } from './entries';
import { seedAccount, seedSubcategory } from './testing';
import { createTransaction } from './transactions';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
let bank: string;
let a: string;
let b: string;
let target: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  bank = await seedAccount(t.database, adas, 'USD');
  a = await seedSubcategory(t.database, adas);
  b = await seedSubcategory(t.database, adas);
  target = await seedSubcategory(t.database, adas);
});
afterAll(async () => t.close());

const spend = async (...subs: [string, number][]) => {
  const total = subs.reduce((sum, [, amount]) => sum + amount, 0);
  const result = await createTransaction(t.database, t.ada.id, adas, {
    type: 'expense',
    date: '2026-11-06',
    lines: [
      { account: bank, amount: -total, currency: 'USD' },
      ...subs.map(([subcategory, amount]) => ({ subcategory, amount, currency: 'USD' })),
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
};
const subcategoriesOf = async (id: string) =>
  ((await getEntry(t.database, t.ada.id, adas, id))?.lines ?? [])
    .map((l) => l.subcategory)
    .filter(Boolean);
const lineCount = async (id: string) =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'txn_line')} WHERE txn_id = ${id}`,
      )
    )[0]?.n,
  );

describe(`marking several (${leg})`, () => {
  it('sets the status of the account’s own, once each, and counts what it left', async () => {
    const [x, y] = [await spend([a, 100]), await spend([a, 200])];
    expect(
      await bulkSetStatus(t.database, t.ada.id, adas, [x, y, y, crypto.randomUUID()], 'cleared'),
    ).toEqual({ changed: 2, skipped: 1 });
    expect((await getEntry(t.database, t.ada.id, adas, x))?.status).toBe('cleared');
    expect(await bulkSetStatus(t.database, t.ada.id, adas, [x], 'pending')).toEqual({
      changed: 1,
      skipped: 0,
    });
    expect((await getEntry(t.database, t.ada.id, adas, x))?.status).toBe('pending');
  });

  it('refuses what is not a list of 1 to 200 ids, or not a status, and changes nothing', async () => {
    const x = await spend([a, 100]);
    expect(await bulkSetStatus(t.database, t.ada.id, adas, [], 'cleared')).toBeUndefined();
    expect(await bulkSetStatus(t.database, t.ada.id, adas, [1], 'cleared')).toBeUndefined();
    expect(
      await bulkSetStatus(
        t.database,
        t.ada.id,
        adas,
        Array.from({ length: 201 }, (_, i) => `id${i}`),
        'cleared',
      ),
    ).toBeUndefined();
    expect(await bulkSetStatus(t.database, t.ada.id, adas, [x], 'done' as never)).toBeUndefined();
    expect((await getEntry(t.database, t.ada.id, adas, x))?.status).toBe('pending');
  });

  it('is not another person’s to do, even naming their book: nothing changes', async () => {
    const x = await spend([a, 100]);
    expect(await bulkSetStatus(t.database, t.grace.id, adas, [x], 'cleared')).toEqual({
      changed: 0,
      skipped: 1,
    });
    expect(await bulkSetStatus(t.database, t.grace.id, graces, [x], 'cleared')).toEqual({
      changed: 0,
      skipped: 1,
    });
    expect((await getEntry(t.database, t.ada.id, adas, x))?.status).toBe('pending');
  });
});

describe(`moving several (${leg})`, () => {
  it('moves the entries with one subcategory line, and leaves a split, an income and a transfer, counting them', async () => {
    const one = await spend([a, 100]);
    const split = await spend([a, 60], [b, 40]);
    const other = await seedAccount(t.database, adas, 'USD', 'cash');
    const transfer = await createTransaction(t.database, t.ada.id, adas, {
      type: 'transfer',
      date: '2026-11-06',
      lines: [
        { account: bank, amount: -5, currency: 'USD' },
        { account: other, amount: 5, currency: 'USD' },
      ],
    });
    if (!transfer.ok) throw new Error('not written');
    expect(
      await bulkRecategorise(t.database, t.ada.id, adas, [one, split, transfer.id], target),
    ).toEqual({ changed: 1, skipped: 2 });
    expect(await subcategoriesOf(one)).toEqual([target]);
    expect((await subcategoriesOf(split)).sort()).toEqual([a, b].sort());
  });

  it('refuses a subcategory that is archived, that is another person’s or that is not there, and moves nothing', async () => {
    const one = await spend([a, 100]);
    const archived = await seedSubcategory(t.database, adas);
    await dbAll(
      t.database,
      sql`UPDATE ${tableNamed(t.database, 'subcategory')} SET archived_at = 5 WHERE id = ${archived} RETURNING id`,
    );
    const hers = await seedSubcategory(t.database, graces);
    for (const wrong of [archived, hers, crypto.randomUUID()])
      expect(await bulkRecategorise(t.database, t.ada.id, adas, [one], wrong)).toEqual({
        changed: 0,
        skipped: 1,
      });
    expect(await subcategoriesOf(one)).toEqual([a]);
    expect(await bulkRecategorise(t.database, t.ada.id, adas, [one], '')).toBeUndefined();
  });

  it('is not another person’s to do: nothing moves', async () => {
    const one = await spend([a, 100]);
    expect(await bulkRecategorise(t.database, t.grace.id, adas, [one], target)).toEqual({
      changed: 0,
      skipped: 1,
    });
    expect(
      await bulkRecategorise(
        t.database,
        t.grace.id,
        graces,
        [one],
        await seedSubcategory(t.database, graces),
      ),
    ).toEqual({ changed: 0, skipped: 1 });
    expect(await subcategoriesOf(one)).toEqual([a]);
  });
});

describe(`deleting several (${leg})`, () => {
  it('deletes the entries with their lines, and leaves what is not the account’s', async () => {
    const [x, y] = [await spend([a, 100]), await spend([a, 60], [b, 40])];
    expect(await bulkDelete(t.database, t.grace.id, adas, [x, y])).toEqual({
      changed: 0,
      skipped: 2,
    });
    expect(await lineCount(x)).toBe(2);
    expect(await bulkDelete(t.database, t.ada.id, adas, [x, y, crypto.randomUUID()])).toEqual({
      changed: 2,
      skipped: 1,
    });
    expect(await lineCount(x)).toBe(0);
    expect(await lineCount(y)).toBe(0);
    expect(await bulkDelete(t.database, t.ada.id, adas, [x])).toEqual({ changed: 0, skipped: 1 });
    expect(await bulkDelete(t.database, t.ada.id, adas, [])).toBeUndefined();
  });
});
