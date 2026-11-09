import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIn, monthOf, addMonths } from '../dates';
import { testTarget } from '../db/test-support';
import { bookIdFor, ensureBook } from '../ledger/books';
import { seedIncomeSource, seedSubcategory } from '../ledger/testing';
import { read, write } from './budget-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The budget route, **called as the second person** (DESIGN.md §5.2): another person's subcategory is a 404 with nothing in it, and nothing is written. */
const { leg } = testTarget();

let t: TwoAccounts;
let food: string;
let pay: string;
let gracesFood: string;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  food = await seedSubcategory(t.database, bookIdFor(t.ada.id));
  pay = await seedIncomeSource(t.database, bookIdFor(t.ada.id));
  gracesFood = await seedSubcategory(t.database, bookIdFor(t.grace.id));
});
afterAll(async () => t.close());

const call = (
  handler: (database: typeof t.database, context: Parameters<BookHandler>[0]) => Promise<Response>,
  person: Person | null,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  bookRoute((context) => handler(t.database, context), t.deps)(t.request(person, path, init), {
    params: Promise.resolve({}),
  });

const now = monthOf(todayIn('UTC'));
const put = (person: Person | null, body: unknown, headers?: Record<string, string>) =>
  call(write, person, '/api/budget', { method: 'POST', body, headers });
const history = async (person: Person, kind: string, id: string) =>
  (
    (await (await call(read, person, `/api/budget?kind=${kind}&id=${id}`)).json()) as {
      history: { fromMonth: string; amount: number }[];
    }
  ).history;

describe(`the budget route (${leg})`, () => {
  it('sets a budget from this month or from next, by the book’s own clock, and reads it back', async () => {
    expect(
      (await put(t.ada, { kind: 'subcategory', id: food, amount: 40_000, when: 'this' })).status,
    ).toBe(200);
    expect(
      (await put(t.ada, { kind: 'subcategory', id: food, amount: 45_000, when: 'next' })).status,
    ).toBe(200);
    expect((await history(t.ada, 'subcategory', food)).map((r) => [r.fromMonth, r.amount])).toEqual(
      [
        [now, 40_000],
        [addMonths(now, 1), 45_000],
      ],
    );
    const month = (await (
      await call(read, t.ada, `/api/budget?month=${addMonths(now, 1)}`)
    ).json()) as { amounts: Record<string, number> };
    expect(month.amounts[`subcategory:${food}`]).toBe(45_000);
    const before = (await (
      await call(read, t.ada, `/api/budget?month=${addMonths(now, -1)}`)
    ).json()) as { amounts: Record<string, number> };
    expect(before.amounts[`subcategory:${food}`]).toBeUndefined();
  });

  it('cannot be made to write a past month: the request has no month, and a month in the body is not obeyed', async () => {
    await put(t.ada, {
      kind: 'income',
      id: pay,
      amount: 100,
      when: 'this',
      month: '2020-01',
      fromMonth: '2020-01',
      currentMonth: '2020-01',
    });
    expect((await history(t.ada, 'income', pay)).map((r) => r.fromMonth)).toEqual([now]);
  });

  it('answers a visitor 401 and a request from another address 403, and writes nothing', async () => {
    expect(
      (await put(null, { kind: 'subcategory', id: food, amount: 1, when: 'this' })).status,
    ).toBe(401);
    expect(
      (
        await put(
          t.ada,
          { kind: 'subcategory', id: food, amount: 1, when: 'this' },
          { origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect((await call(read, null, `/api/budget?month=${now}`)).status).toBe(401);
  });

  it('is not another person’s: a 404 with nothing in it, nothing is written, and nothing of Ada’s is read', async () => {
    const before = JSON.stringify(await history(t.ada, 'subcategory', food));
    for (const id of [food, crypto.randomUUID()]) {
      const reply = await put(t.grace, { kind: 'subcategory', id, amount: 1, when: 'this' });
      expect(reply.status).toBe(404);
      expect(await reply.text()).toBe('');
    }
    expect(
      (await put(t.ada, { kind: 'subcategory', id: gracesFood, amount: 1, when: 'this' })).status,
    ).toBe(404);
    expect(await history(t.grace, 'subcategory', food)).toEqual([]);
    const hers = (await (await call(read, t.grace, `/api/budget?month=${now}`)).json()) as {
      amounts: Record<string, number>;
    };
    expect(hers.amounts).toEqual({});
    expect(JSON.stringify(await history(t.ada, 'subcategory', food))).toBe(before);
  });

  it('answers a mistake with sentences and a 400', async () => {
    for (const body of [
      {},
      { kind: 'loan', id: food, amount: 1, when: 'this' },
      { kind: 'subcategory', id: food, amount: '1', when: 'this' },
      { kind: 'subcategory', id: food, amount: 1, when: 'last' },
      { kind: 'subcategory', id: 5, amount: 1, when: 'this' },
      [],
      null,
    ])
      expect((await put(t.ada, body)).status, JSON.stringify(body)).toBe(400);
    expect(
      (await put(t.ada, { kind: 'subcategory', id: food, amount: -1, when: 'this' })).status,
    ).toBe(400);
    expect(
      (await put(t.ada, { kind: 'subcategory', id: food, amount: 1.5, when: 'this' })).status,
    ).toBe(400);
    for (const path of [
      '/api/budget',
      '/api/budget?month=2026-13',
      '/api/budget?kind=loan&id=x',
      '/api/budget?kind=subcategory',
    ])
      expect((await call(read, t.ada, path)).status, path).toBe(400);
  });
});
