import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { testTarget } from '../db/test-support';
import { ensureBook } from '../ledger/books';
import { seedIncomeSource, seedSubcategory } from '../ledger/testing';
import { budgetsForMonth, budgetHistory, effectiveMonth, endBudget, setBudget } from './amounts';
import { budgetFor } from './budget-for';

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

const set = (
  targetId: string,
  amount: number,
  when: 'this' | 'next',
  currentMonth: string,
  kind: 'subcategory' | 'income' = 'subcategory',
) => setBudget(t.database, t.ada.id, adas, { kind, targetId, amount, when, currentMonth });
const inForce = async (month: string) => budgetsForMonth(t.database, t.ada.id, adas, month);

describe(`the budget as it was (${leg})`, () => {
  it('is where it was for a past month after a raise from March: February keeps its old amount', async () => {
    const groceries = await seedSubcategory(t.database, adas);
    expect(await set(groceries, 40_000, 'this', '2026-01')).toEqual({ ok: true, id: groceries });
    expect(await set(groceries, 45_000, 'this', '2026-03')).toEqual({ ok: true, id: groceries });
    const key = `subcategory:${groceries}`;
    expect((await inForce('2026-01')).get(key)).toBe(40_000);
    expect((await inForce('2026-02')).get(key)).toBe(40_000);
    expect((await inForce('2026-03')).get(key)).toBe(45_000);
    expect((await inForce('2027-06')).get(key)).toBe(45_000);
    // Before the first row there is no budget, which is not a budget of nothing.
    expect((await inForce('2025-12')).has(key)).toBe(false);
    expect(
      (await budgetHistory(t.database, t.ada.id, adas, 'subcategory', groceries)).map((r) => [
        r.fromMonth,
        r.amount,
      ]),
    ).toEqual([
      ['2026-01', 40_000],
      ['2026-03', 45_000],
    ]);
  });

  it('keeps the later of two changes in one month, and one row for it', async () => {
    const dining = await seedSubcategory(t.database, adas);
    await set(dining, 10_000, 'this', '2026-05');
    await set(dining, 12_500, 'this', '2026-05');
    expect((await inForce('2026-05')).get(`subcategory:${dining}`)).toBe(12_500);
    expect(await budgetHistory(t.database, t.ada.id, adas, 'subcategory', dining)).toHaveLength(1);
    // Next month from May is June, and a change for June replaces only June.
    await set(dining, 20_000, 'next', '2026-05');
    await set(dining, 21_000, 'this', '2026-06');
    expect((await inForce('2026-05')).get(`subcategory:${dining}`)).toBe(12_500);
    expect((await inForce('2026-06')).get(`subcategory:${dining}`)).toBe(21_000);
  });

  it('is changed from this month or from next, and never from one that is past', async () => {
    const fun = await seedSubcategory(t.database, adas);
    expect(effectiveMonth('2026-12', 'this')).toBe('2026-12');
    expect(effectiveMonth('2026-12', 'next')).toBe('2027-01');
    await set(fun, 100, 'next', '2026-12');
    await set(fun, 200, 'this', '2026-12');
    const months = (await budgetHistory(t.database, t.ada.id, adas, 'subcategory', fun)).map(
      (r) => r.fromMonth,
    );
    expect(months).toEqual(['2026-12', '2027-01']);
    // No call can name a month before the current one: nothing earlier is in the history.
    expect(months.every((month) => month >= '2026-12')).toBe(true);
  });

  it('ends with a zero, from this month or next, and a month before it is as it was', async () => {
    const gym = await seedSubcategory(t.database, adas);
    await set(gym, 5_000, 'this', '2026-01');
    expect(
      await endBudget(t.database, t.ada.id, adas, {
        kind: 'subcategory',
        targetId: gym,
        when: 'next',
        currentMonth: '2026-06',
      }),
    ).toEqual({ ok: true, id: gym });
    const key = `subcategory:${gym}`;
    expect((await inForce('2026-06')).get(key)).toBe(5_000);
    expect((await inForce('2026-07')).get(key)).toBe(0);
    expect(
      budgetFor(await budgetHistory(t.database, t.ada.id, adas, 'subcategory', gym), '2026-09'),
    ).toBe(0);
  });

  it('is kept for an income source, apart from a subcategory with the same id', async () => {
    const pay = await seedIncomeSource(t.database, adas);
    expect(await set(pay, 300_000, 'this', '2026-02', 'income')).toEqual({ ok: true, id: pay });
    expect((await inForce('2026-02')).get(`income:${pay}`)).toBe(300_000);
    // An income source is not a subcategory, and a subcategory is not an income source.
    expect(await set(pay, 1, 'this', '2026-02', 'subcategory')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    const sub = await seedSubcategory(t.database, adas);
    expect(await set(sub, 1, 'this', '2026-02', 'income')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('refuses what is not a budget, with a sentence, and writes nothing', async () => {
    const sub = await seedSubcategory(t.database, adas);
    for (const [input, kind, when] of [
      [-1, 'subcategory', 'this'],
      [1.5, 'subcategory', 'this'],
      [Number.NaN, 'subcategory', 'this'],
      [2 ** 60, 'subcategory', 'this'],
      [100, 'loan', 'this'],
      [100, 'subcategory', 'last'],
    ] as const)
      expect(
        await set(sub, input, when as never, '2026-02', kind as never),
        `${input} ${kind} ${when}`,
      ).toMatchObject({ ok: false, reason: 'invalid' });
    await expect(set(sub, 100, 'this', '2026-13')).rejects.toThrow(RangeError);
    expect(await budgetHistory(t.database, t.ada.id, adas, 'subcategory', sub)).toEqual([]);
    expect(await set('', 100, 'this', '2026-02')).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe(`another person’s budget (${leg})`, () => {
  it('is not theirs to set, read or end: it is not there, and nothing changes', async () => {
    const mine = await seedSubcategory(t.database, adas);
    await set(mine, 9_000, 'this', '2026-04');
    const theirs = await seedSubcategory(t.database, graces);
    const asGrace = (bookId: string, targetId: string) =>
      setBudget(t.database, t.grace.id, bookId, {
        kind: 'subcategory',
        targetId,
        amount: 1,
        when: 'this',
        currentMonth: '2026-04',
      });
    expect(await asGrace(adas, mine)).toEqual({ ok: false, reason: 'not_found' });
    expect(await asGrace(graces, mine)).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await setBudget(t.database, t.ada.id, adas, {
        kind: 'subcategory',
        targetId: theirs,
        amount: 1,
        when: 'this',
        currentMonth: '2026-04',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await endBudget(t.database, t.grace.id, adas, {
        kind: 'subcategory',
        targetId: mine,
        when: 'this',
        currentMonth: '2026-04',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await budgetHistory(t.database, t.grace.id, adas, 'subcategory', mine)).toEqual([]);
    expect([...(await budgetsForMonth(t.database, t.grace.id, adas, '2026-04')).keys()]).toEqual(
      [],
    );
    expect([...(await budgetsForMonth(t.database, t.grace.id, graces, '2026-04')).keys()]).toEqual(
      [],
    );
    expect((await inForce('2026-04')).get(`subcategory:${mine}`)).toBe(9_000);
    expect(await budgetHistory(t.database, t.ada.id, graces, 'subcategory', theirs)).toEqual([]);
  });
});
