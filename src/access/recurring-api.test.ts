import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { ensureBook } from '../ledger/books';
import { seedAccount, seedSubcategory } from '../ledger/testing';
import { createTransaction } from '../ledger/transactions';
import { change, create, list, remove } from './recurring-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The recurring routes, **called as the second person** (DESIGN.md §5.2): another person's recurring entry is a 404 with nothing in it, and nothing changes. */
const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
let bank: string;
let rent: string;
let hers: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  bank = await seedAccount(t.database, adas, 'USD');
  rent = await seedSubcategory(t.database, adas);
  hers = await seedSubcategory(t.database, graces);
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

const template = (sub = rent, amount = 1_200) => ({
  type: 'expense',
  lines: [
    { account: bank, amount: -amount, currency: 'USD' },
    { subcategory: sub, amount, currency: 'USD' },
  ],
  payee: 'Landlord',
  note: null,
});
const body = (over: Record<string, unknown> = {}) => ({
  template: template(),
  unit: 'month',
  every: 1,
  anchor: '2099-01-01',
  mode: 'auto',
  ...over,
});
const make = async (over: Record<string, unknown> = {}) => {
  const reply = await call(create, t.ada, '/api/recurring', { method: 'POST', body: body(over) });
  expect(reply.status).toBe(201);
  return ((await reply.json()) as { id: string }).id;
};
const listed = async (person: Person) =>
  (
    (await (await call(list, person, '/api/recurring')).json()) as {
      recurring: { id: string; mode: string; nextDate: string | null; endedAt: number | null }[];
    }
  ).recurring;

describe(`the recurring routes (${leg})`, () => {
  it('make an entry repeat in the caller’s own book and list it; another person lists none of it', async () => {
    const id = await make();
    expect((await listed(t.ada)).find((r) => r.id === id)).toMatchObject({
      mode: 'auto',
      nextDate: '2099-01-01',
      endedAt: null,
    });
    expect(await listed(t.grace)).toEqual([]);
    expect((await call(list, null, '/api/recurring')).status).toBe(401);
  });

  it('make an entry that was written repeat, and refuse another person’s entry as not found', async () => {
    const entry = await createTransaction(t.database, t.ada.id, adas, {
      type: 'expense',
      date: '2099-02-01',
      lines: template().lines,
    });
    if (!entry.ok) throw new Error('not written');
    const hersEntry = await call(create, t.grace, '/api/recurring', {
      method: 'POST',
      body: { entryId: entry.id, unit: 'month', every: 1, mode: 'auto' },
    });
    expect(hersEntry.status).toBe(404);
    expect(await hersEntry.text()).toBe('');
    const mine = await call(create, t.ada, '/api/recurring', {
      method: 'POST',
      body: { entryId: entry.id, unit: 'month', every: 1, mode: 'confirm' },
    });
    expect(mine.status).toBe(201);
  });

  it('answer another address 403, and a mistake with sentences and a 400, writing nothing', async () => {
    const before = (await listed(t.ada)).length;
    expect(
      (
        await call(create, t.ada, '/api/recurring', {
          method: 'POST',
          body: body(),
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    for (const bad of [
      { every: 'x' },
      { every: 0 },
      { unit: 'hour' },
      { mode: 'maybe' },
      { anchor: 5 },
      { anchor: '2099-02-30' },
      { template: 'nope' },
      { template: { ...template(), type: 'opening' } },
      { template: { ...template(), lines: [{ amount: 'x' }] } },
      { end: 7 },
    ]) {
      const reply = await call(create, t.ada, '/api/recurring', {
        method: 'POST',
        body: body(bad),
      });
      expect(reply.status, JSON.stringify(bad)).toBe(400);
      expect(((await reply.json()) as { problems: string[] }).problems.length).toBeGreaterThan(0);
    }
    expect((await call(create, t.ada, '/api/recurring', { method: 'POST', body: [] })).status).toBe(
      400,
    );
    expect((await listed(t.ada)).length).toBe(before);
  });

  it('refuse a template that points at another person’s subcategory as not found', async () => {
    const before = (await listed(t.ada)).length;
    const reply = await call(create, t.ada, '/api/recurring', {
      method: 'POST',
      body: body({ template: template(hers) }),
    });
    expect(reply.status).toBe(404);
    expect((await listed(t.ada)).length).toBe(before);
  });

  it('change and end what is to come, for the owner; for another person it is not found and nothing changes', async () => {
    const id = await make();
    const path = `/api/recurring/${id}`;
    const strange = await call(
      change,
      t.grace,
      path,
      { method: 'PATCH', body: { mode: 'confirm' } },
      id,
    );
    expect(strange.status).toBe(404);
    expect(await strange.text()).toBe('');
    expect((await call(remove, t.grace, path, { method: 'DELETE' }, id)).status).toBe(404);
    expect((await listed(t.ada)).find((r) => r.id === id)).toMatchObject({
      mode: 'auto',
      endedAt: null,
    });

    expect(
      (await call(change, t.ada, path, { method: 'PATCH', body: { mode: 'confirm' } }, id)).status,
    ).toBe(200);
    expect(
      (await call(change, t.ada, path, { method: 'PATCH', body: { mode: 'sometimes' } }, id))
        .status,
    ).toBe(400);
    expect((await call(change, t.ada, path, { method: 'PATCH', body: {} }, id)).status).toBe(400);
    expect(
      (await call(change, t.ada, path, { method: 'PATCH', body: { ended: false } }, id)).status,
    ).toBe(400);
    expect(
      (await call(change, t.ada, path, { method: 'PATCH', body: { template: template(hers) } }, id))
        .status,
    ).toBe(404);
    expect((await listed(t.ada)).find((r) => r.id === id)).toMatchObject({
      mode: 'confirm',
      endedAt: null,
    });

    expect((await call(remove, t.ada, path, { method: 'DELETE' }, id)).status).toBe(200);
    expect((await listed(t.ada)).find((r) => r.id === id)?.endedAt).not.toBeNull();
    expect((await call(remove, t.ada, path, { method: 'DELETE' }, id)).status).toBe(200);
    expect(
      (await call(change, t.ada, path, { method: 'PATCH', body: { ended: true } }, id)).status,
    ).toBe(200);
    expect(
      (await call(remove, t.ada, '/api/recurring/nope', { method: 'DELETE' }, 'nope')).status,
    ).toBe(404);
  });
});
