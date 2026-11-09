import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { balanceOf } from './balances';
import { ensureBook } from './books';
import { getEntry } from './entries';
import { findViolations } from './invariants';
import { reconcile, reconcileSummary } from './reconcile';
import { seedAccount, seedSubcategory } from './testing';
import { createTransaction } from './transactions';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
let food: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  food = await seedSubcategory(t.database, adas);
});
afterAll(async () => t.close());

const entry = async (
  account: string,
  type: 'opening' | 'expense',
  date: string,
  amount: number,
  status?: 'pending' | 'cleared',
) => {
  const result = await createTransaction(t.database, t.ada.id, adas, {
    type,
    date,
    ...(status ? { status } : {}),
    lines:
      type === 'opening'
        ? [
            { account, amount, currency: 'USD' },
            { equity: 'opening', amount: -amount, currency: 'USD' },
          ]
        : [
            { account, amount: -amount, currency: 'USD' },
            { subcategory: food, amount, currency: 'USD' },
          ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
};
const status = async (id: string) => (await getEntry(t.database, t.ada.id, adas, id))?.status;
const count = async (type: string) =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'txn')} WHERE type = ${type} AND book_id = ${adas}`,
      )
    )[0]?.n,
  );

describe(`reconciling (${leg})`, () => {
  it('compares the statement with every entry to the date, and says how many are pending', async () => {
    const bank = await seedAccount(t.database, adas, 'USD');
    await entry(bank, 'opening', '2026-10-01', 10000);
    await entry(bank, 'expense', '2026-10-10', 2000);
    await entry(bank, 'expense', '2026-10-25', 500);
    expect(await reconcileSummary(t.database, t.ada.id, adas, bank, '2026-10-15')).toEqual({
      currency: 'USD',
      balance: 8000,
      pending: 1,
    });
    expect(await reconcileSummary(t.database, t.ada.id, adas, bank, '2026-10-31')).toEqual({
      currency: 'USD',
      balance: 7500,
      pending: 2,
    });
    expect(await reconcileSummary(t.database, t.ada.id, adas, bank, '2026-09-01')).toEqual({
      currency: 'USD',
      balance: 0,
      pending: 0,
    });
    await expect(reconcileSummary(t.database, t.ada.id, adas, bank, '2026-02-30')).rejects.toThrow(
      RangeError,
    );
  });

  it('records an adjustment for a statement 1.20 above, clears every entry to the date, and again to the same figure records nothing', async () => {
    const bank = await seedAccount(t.database, adas, 'USD');
    const opening = await entry(bank, 'opening', '2026-10-01', 10000);
    const early = await entry(bank, 'expense', '2026-10-10', 2000);
    const late = await entry(bank, 'expense', '2026-10-25', 500);
    expect(await status(opening)).toBe('cleared');
    expect(await status(early)).toBe('pending');

    // The ledger says 80.00 on the 15th; the statement says 81.20.
    const first = await reconcile(t.database, t.ada.id, adas, bank, {
      date: '2026-10-15',
      balance: 8120,
    });
    expect(first).toEqual({ ok: true, adjustment: 120, cleared: 1 });
    expect(await status(early)).toBe('cleared');
    expect(await status(late)).toBe('pending');
    expect(await balanceOf(t.database, t.ada.id, adas, bank, '2026-10-15')).toBe(8120);
    expect(await balanceOf(t.database, t.ada.id, adas, bank)).toBe(8120 - 500);

    const adjustments = async () =>
      await dbAll<{ id: string; date: string; status: string; note: string | null }>(
        t.database,
        sql`SELECT t.id AS id, t.date AS date, t.status AS status, t.note AS note FROM ${tableNamed(t.database, 'txn')} t JOIN ${tableNamed(t.database, 'txn_line')} l ON l.txn_id = t.id WHERE t.type = 'adjustment' AND l.account_id = ${bank}`,
      );
    expect(await adjustments()).toEqual([
      expect.objectContaining({
        date: '2026-10-15',
        status: 'cleared',
        note: 'Reconciled to the statement',
      }),
    ]);

    const again = await reconcile(t.database, t.ada.id, adas, bank, {
      date: '2026-10-15',
      balance: 8120,
    });
    expect(again).toEqual({ ok: true, adjustment: 0, cleared: 0 });
    expect(await adjustments()).toHaveLength(1);
    expect(await findViolations(t.database, adas)).toEqual([]);
  });

  it('is not thrown off by a pending entry the statement already shows: it is cleared, not corrected twice', async () => {
    const bank = await seedAccount(t.database, adas, 'USD');
    await entry(bank, 'opening', '2026-10-01', 10000);
    await entry(bank, 'expense', '2026-10-10', 2000);
    // Ledger 80.00 with that entry pending; the statement says 80.00: nothing to record.
    expect(
      await reconcile(t.database, t.ada.id, adas, bank, { date: '2026-10-31', balance: 8000 }),
    ).toEqual({ ok: true, adjustment: 0, cleared: 1 });
    expect(await balanceOf(t.database, t.ada.id, adas, bank)).toBe(8000);
  });

  it('records a difference below nothing too, and keeps the sign for what is owed on a card', async () => {
    const bank = await seedAccount(t.database, adas, 'USD');
    await entry(bank, 'opening', '2026-10-01', 10000);
    expect(
      await reconcile(t.database, t.ada.id, adas, bank, { date: '2026-10-31', balance: 9850 }),
    ).toEqual({ ok: true, adjustment: -150, cleared: 0 });
    const card = await seedAccount(t.database, adas, 'USD', 'credit_card');
    await entry(card, 'opening', '2026-10-01', -42000);
    // The statement says 430.00 is owed: that is a balance of −430.00, which is 10.00 further below.
    expect(
      await reconcile(t.database, t.ada.id, adas, card, { date: '2026-10-31', balance: -43000 }),
    ).toEqual({ ok: true, adjustment: -1000, cleared: 0 });
    expect(await balanceOf(t.database, t.ada.id, adas, card)).toBe(-43000);
  });

  it('refuses a day or an amount that is not one, with a sentence, and changes nothing', async () => {
    const bank = await seedAccount(t.database, adas, 'USD');
    const open = await entry(bank, 'opening', '2026-10-01', 10000);
    const spent = await entry(bank, 'expense', '2026-10-10', 2000);
    const before = await count('adjustment');
    for (const input of [
      { date: '2026-02-30', balance: 1 },
      { date: '', balance: 1 },
      { date: '2026-10-31', balance: 1.5 },
      { date: '2026-10-31', balance: Number.NaN },
      { date: '2026-10-31', balance: 2 ** 60 },
    ]) {
      expect(
        await reconcile(t.database, t.ada.id, adas, bank, input),
        JSON.stringify(input),
      ).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(await count('adjustment')).toBe(before);
    expect(await status(spent)).toBe('pending');
    expect(await status(open)).toBe('cleared');
  });
});

describe(`another person’s account (${leg})`, () => {
  it('is not theirs to reconcile or look at: nothing is cleared and nothing is recorded', async () => {
    const bank = await seedAccount(t.database, adas, 'USD');
    await entry(bank, 'opening', '2026-10-01', 10000);
    const spent = await entry(bank, 'expense', '2026-10-10', 2000);
    const before = await count('adjustment');
    expect(
      await reconcileSummary(t.database, t.grace.id, adas, bank, '2026-10-31'),
    ).toBeUndefined();
    expect(
      await reconcileSummary(t.database, t.grace.id, graces, bank, '2026-10-31'),
    ).toBeUndefined();
    expect(
      await reconcile(t.database, t.grace.id, adas, bank, { date: '2026-10-31', balance: 1 }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await reconcile(t.database, t.grace.id, graces, bank, { date: '2026-10-31', balance: 1 }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await reconcile(t.database, t.ada.id, adas, crypto.randomUUID(), {
        date: '2026-10-31',
        balance: 1,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await count('adjustment')).toBe(before);
    expect(await status(spent)).toBe('pending');
  });
});
