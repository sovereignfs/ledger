import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { listAccounts } from './accounts';
import { balanceOf } from './balances';
import { ensureBook } from './books';
import { listEntries } from './entry-list';
import { findViolations } from './invariants';
import { revalue } from './revalue';
import { seedAccount } from './testing';
import { createTransaction } from './transactions';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
});
afterAll(async () => t.close());

const opened = async (type: string, amount: number, date = '2026-01-01') => {
  const account = await seedAccount(t.database, adas, 'USD', type, type);
  const result = await createTransaction(t.database, t.ada.id, adas, {
    type: 'opening',
    date,
    lines: [
      { account, amount, currency: 'USD' },
      { equity: 'opening', amount: -amount, currency: 'USD' },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return account;
};
const count = async (type: string) =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'txn')} WHERE type = ${type} AND book_id = ${adas}`,
      )
    )[0]?.n,
  );
const total = async () =>
  (await listAccounts(t.database, t.ada.id, adas)).reduce((sum, a) => sum + a.balance, 0);

describe(`valuing an account (${leg})`, () => {
  it('records the difference against equity: a fund from 10 000 to 10 500 raises net worth by 500, and touches no spending or income', async () => {
    const fund = await opened('investment', 1_000_000);
    const before = await total();
    expect(
      await revalue(t.database, t.ada.id, adas, fund, { date: '2026-06-30', value: 1_050_000 }),
    ).toEqual({ ok: true, change: 50_000 });
    expect(await total()).toBe(before + 50_000);
    expect(await balanceOf(t.database, t.ada.id, adas, fund)).toBe(1_050_000);
    const entry = (
      await listEntries(t.database, t.ada.id, adas, { account: fund, type: 'revaluation' })
    ).entries[0];
    expect(entry?.lines.map((l) => [l.account ? 'account' : l.equity, l.amount])).toEqual([
      ['account', 50_000],
      ['revaluation', -50_000],
    ]);
    // No subcategory and no income source: no report of spent or of income can move.
    expect(entry?.lines.some((l) => l.subcategory || l.incomeSource)).toBe(false);
    expect(await findViolations(t.database, adas)).toEqual([]);
  });

  it('records a fall, and valuing it at what it is already records nothing', async () => {
    const flat = await opened('property', 20_000_000);
    expect(
      await revalue(t.database, t.ada.id, adas, flat, { date: '2026-06-30', value: 19_000_000 }),
    ).toEqual({ ok: true, change: -1_000_000 });
    const entries = await count('revaluation');
    expect(
      await revalue(t.database, t.ada.id, adas, flat, { date: '2026-06-30', value: 19_000_000 }),
    ).toEqual({ ok: true, change: 0 });
    expect(await count('revaluation')).toBe(entries);
    expect(
      await revalue(t.database, t.ada.id, adas, flat, { date: '2026-06-30', value: 0 }),
    ).toEqual({ ok: true, change: -19_000_000 });
  });

  it('values it on a day, counting only what is up to that day, and keeps a history of the changes and what it was worth after each', async () => {
    const fund = await opened('investment', 100_000, '2026-01-01');
    expect(
      await revalue(t.database, t.ada.id, adas, fund, { date: '2026-03-31', value: 110_000 }),
    ).toEqual({ ok: true, change: 10_000 });
    expect(
      await revalue(t.database, t.ada.id, adas, fund, { date: '2026-06-30', value: 125_000 }),
    ).toEqual({ ok: true, change: 15_000 });
    // A value given for an earlier day counts only what was there then, and so moves every later day by its change.
    expect(
      await revalue(t.database, t.ada.id, adas, fund, { date: '2026-02-15', value: 105_000 }),
    ).toEqual({ ok: true, change: 5_000 });
    const history = (
      await listEntries(t.database, t.ada.id, adas, { account: fund, type: 'revaluation' })
    ).entries;
    expect(history.map((e) => [e.date, e.lines[0]?.amount, e.balanceAfter])).toEqual([
      ['2026-06-30', 15_000, 130_000],
      ['2026-03-31', 10_000, 115_000],
      ['2026-02-15', 5_000, 105_000],
    ]);
  });

  it('is only for an investment or a property, in a sentence, and writes nothing otherwise', async () => {
    const bank = await opened('bank', 5_000);
    const before = await count('revaluation');
    expect(
      await revalue(t.database, t.ada.id, adas, bank, { date: '2026-06-30', value: 9_000 }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
      problems: ['Only an investment or a property is given a value.'],
    });
    expect(await count('revaluation')).toBe(before);
    expect(await balanceOf(t.database, t.ada.id, adas, bank)).toBe(5_000);
  });

  it('refuses a day or a value that is not one, and changes nothing', async () => {
    const fund = await opened('investment', 1_000);
    const before = await count('revaluation');
    for (const input of [
      { date: '2026-02-30', value: 1 },
      { date: '', value: 1 },
      { date: '2026-06-30', value: -1 },
      { date: '2026-06-30', value: 1.5 },
      { date: '2026-06-30', value: Number.NaN },
    ])
      expect(
        await revalue(t.database, t.ada.id, adas, fund, input),
        JSON.stringify(input),
      ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await count('revaluation')).toBe(before);
  });

  it('is not another person’s to value: nothing is recorded', async () => {
    const fund = await opened('investment', 1_000);
    const before = await count('revaluation');
    expect(
      await revalue(t.database, t.grace.id, adas, fund, { date: '2026-06-30', value: 9_000 }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await revalue(t.database, t.grace.id, graces, fund, { date: '2026-06-30', value: 9_000 }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await revalue(t.database, t.ada.id, adas, crypto.randomUUID(), {
        date: '2026-06-30',
        value: 9_000,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await count('revaluation')).toBe(before);
    expect(await balanceOf(t.database, t.ada.id, adas, fund)).toBe(1_000);
  });
});
