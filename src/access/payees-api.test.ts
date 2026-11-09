import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { bookIdFor, ensureBook } from '../ledger/books';
import { seedAccount, seedSubcategory } from '../ledger/testing';
import { createTransaction } from '../ledger/transactions';
import { change, list, read } from './payees-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The payee routes, **called as the second person** (DESIGN.md §5.2): each answers for another person's payee as for one that never was, and changes nothing. */
const { leg } = testTarget();

let t: TwoAccounts;
let bank: string;
let food: string;
beforeAll(async () => {
  t = await twoAccounts();
  const ada = bookIdFor(t.ada.id);
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  bank = await seedAccount(t.database, ada, 'USD');
  food = await seedSubcategory(t.database, ada);
});
afterAll(async () => t.close());

const call = (
  handler: (database: typeof t.database, context: Parameters<BookHandler>[0]) => Promise<Response>,
  person: Person | null,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  id?: string,
) =>
  bookRoute((context) => handler(t.database, context), t.deps)(t.request(person, path, init), {
    params: Promise.resolve(id === undefined ? {} : { id }),
  });

const spend = async (payee: string, amount = 1000) =>
  createTransaction(t.database, t.ada.id, bookIdFor(t.ada.id), {
    type: 'expense',
    date: '2026-11-06',
    payee,
    lines: [
      { account: bank, amount: -amount, currency: 'USD' },
      { subcategory: food, amount, currency: 'USD' },
    ],
  });
const found = async (person: Person, query = '') =>
  (
    (await (await call(list, person, `/api/payees?q=${encodeURIComponent(query)}`)).json()) as {
      payees: { id: string; name: string }[];
    }
  ).payees;
const idOfName = async (name: string) =>
  (await found(t.ada, name)).find((p) => p.name === name)?.id as string;

describe(`the payee routes (${leg})`, () => {
  it('find the caller’s payees as they type, and another person has none of them', async () => {
    await spend('Corner Shop');
    await spend('Corner Bakery');
    await spend('Other Place');
    expect((await found(t.ada, 'corner')).map((p) => p.name)).toEqual([
      'Corner Bakery',
      'Corner Shop',
    ]);
    expect(await found(t.grace, 'corner')).toEqual([]);
    expect(await found(t.grace)).toEqual([]);
    expect((await call(list, null, '/api/payees')).status).toBe(401);
  });

  it('read one with its totals by month, and rename, archive and merge, for the owner', async () => {
    await spend('Totals Store', 500);
    const id = await idOfName('Totals Store');
    const got = (await (await call(read, t.ada, `/api/payees/${id}`, {}, id)).json()) as {
      payee: { name: string };
      months: { month: string; spent: number }[];
    };
    expect(got.payee.name).toBe('Totals Store');
    expect(got.months).toEqual([expect.objectContaining({ month: '2026-11', spent: 500 })]);
    expect(
      (
        await call(
          change,
          t.ada,
          `/api/payees/${id}`,
          { method: 'PATCH', body: { name: 'Totals Shop' } },
          id,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          change,
          t.ada,
          `/api/payees/${id}`,
          { method: 'PATCH', body: { archived: true } },
          id,
        )
      ).status,
    ).toBe(200);
    expect(await found(t.ada, 'totals')).toEqual([]);
    await spend('Merge Target');
    const into = await idOfName('Merge Target');
    expect(
      (
        await call(
          change,
          t.ada,
          `/api/payees/${id}`,
          { method: 'PATCH', body: { mergeInto: into } },
          id,
        )
      ).status,
    ).toBe(200);
    expect((await call(read, t.ada, `/api/payees/${id}`, {}, id)).status).toBe(404);
    expect((await call(read, t.ada, `/api/payees/${into}`, {}, into)).status).toBe(200);
  });

  it('are not another person’s to read, rename, archive or merge: each is a 404 with nothing in it, and nothing changes', async () => {
    await spend('Ada Only');
    await spend('Ada Second');
    const id = await idOfName('Ada Only');
    const second = await idOfName('Ada Second');
    const before = JSON.stringify(await found(t.ada));
    for (const [handler, method, body] of [
      [read, 'GET', undefined],
      [change, 'PATCH', { name: 'Hers' }],
      [change, 'PATCH', { archived: true }],
      [change, 'PATCH', { mergeInto: second }],
    ] as const) {
      const reply = await call(handler, t.grace, `/api/payees/${id}`, { method, body }, id);
      expect(reply.status, JSON.stringify(body)).toBe(404);
      expect(await reply.text()).toBe('');
    }
    const never = crypto.randomUUID();
    expect((await call(read, t.grace, `/api/payees/${never}`, {}, never)).status).toBe(404);
    expect(JSON.stringify(await found(t.ada))).toBe(before);
  });

  it('answer a mistake with sentences and a 400, and a taken name by saying to merge', async () => {
    await spend('First Name');
    await spend('Second Name');
    const id = await idOfName('Second Name');
    const bad = async (body: unknown) =>
      (await call(change, t.ada, `/api/payees/${id}`, { method: 'PATCH', body }, id)).status;
    expect(await bad({})).toBe(400);
    expect(await bad({ name: 5 })).toBe(400);
    expect(await bad({ name: '' })).toBe(400);
    expect(await bad({ archived: 'yes' })).toBe(400);
    expect(await bad({ mergeInto: 5 })).toBe(400);
    expect(await bad({ mergeInto: crypto.randomUUID(), name: 'x' })).toBe(400);
    expect(await bad([])).toBe(400);
    const taken = await call(
      change,
      t.ada,
      `/api/payees/${id}`,
      { method: 'PATCH', body: { name: 'first name' } },
      id,
    );
    expect(taken.status).toBe(400);
    expect(((await taken.json()) as { problems: string[] }).problems[0]).toContain(
      'Merge them instead',
    );
  });
});
