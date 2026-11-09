import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { ensureBook } from '../ledger/books';
import { seedAccount, seedSubcategory } from '../ledger/testing';
import { createAccount } from '../ledger/accounts';
import { createTransaction } from '../ledger/transactions';
import { change, create, instalments, list, post, remove, skip, upcoming } from './recurring-api';
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

describe(`confirming from the routes (${leg})`, () => {
  const today = new Date().toISOString().slice(0, 10);
  const waiting = async () =>
    (
      (await (await call(upcoming, t.ada, '/api/upcoming')).json()) as {
        upcoming: { id: string; date: string; state: string }[];
      }
    ).upcoming;
  const act = (
    handler: typeof post,
    person: Person | null,
    id: string,
    what: 'post' | 'skip',
    data: unknown,
    headers?: Record<string, string>,
  ) =>
    call(
      handler,
      person,
      `/api/recurring/${id}/${what}`,
      { method: 'POST', body: data, ...(headers ? { headers } : {}) },
      id,
    );

  it('lists what waits for the caller alone, and posts it with a corrected amount once', async () => {
    const id = await make({ anchor: today, mode: 'confirm', template: template(rent, 9_000) });
    expect((await waiting()).find((row) => row.id === id)).toMatchObject({
      date: today,
      state: 'due',
    });
    expect(
      ((await (await call(upcoming, t.grace, '/api/upcoming')).json()) as { upcoming: unknown[] })
        .upcoming,
    ).toEqual([]);
    expect((await call(upcoming, null, '/api/upcoming')).status).toBe(401);

    const reply = await act(post, t.ada, id, 'post', { date: today, amount: 11_250 });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ posted: true, date: today });
    expect((await waiting()).find((row) => row.id === id)).toBeUndefined();
    // From a window that was not refreshed: nothing more is posted, and it is said.
    const again = await act(post, t.ada, id, 'post', { date: today });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { problems: string[] }).problems[0]).toContain(
      'handled already',
    );
  });

  it('skips, and the occurrence is gone', async () => {
    const id = await make({ anchor: today, mode: 'confirm' });
    expect((await act(skip, t.ada, id, 'skip', { date: today })).status).toBe(200);
    expect((await waiting()).find((row) => row.id === id)).toBeUndefined();
    expect((await act(skip, t.ada, id, 'skip', { date: today })).status).toBe(409);
  });

  it('is not found for another person, and writes nothing', async () => {
    const id = await make({ anchor: today, mode: 'confirm' });
    for (const [handler, what, data] of [
      [post, 'post', { date: today }],
      [post, 'post', { date: today, amount: 5 }],
      [skip, 'skip', { date: today }],
    ] as const) {
      const reply = await act(handler, t.grace, id, what, data);
      expect(reply.status).toBe(404);
      expect(await reply.text()).toBe('');
    }
    expect((await waiting()).find((row) => row.id === id)).toMatchObject({ date: today });
  });

  it('answers another address 403 and a mistake with sentences and a 400', async () => {
    const id = await make({ anchor: today, mode: 'confirm' });
    expect(
      (await act(post, t.ada, id, 'post', { date: today }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(
      (await act(skip, t.ada, id, 'skip', { date: today }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    for (const data of [
      {},
      { date: 5 },
      { date: today, amount: 'x' },
      { date: today, amount: 0 },
      { date: today, amount: 1.5 },
      [],
    ]) {
      const reply = await act(post, t.ada, id, 'post', data);
      expect(reply.status, JSON.stringify(data)).toBe(400);
      expect(((await reply.json()) as { problems: string[] }).problems.length).toBeGreaterThan(0);
    }
    expect((await act(skip, t.ada, id, 'skip', {})).status).toBe(400);
    expect((await waiting()).find((row) => row.id === id)).toMatchObject({ date: today });
  });
});

describe(`a loan's instalments from the routes (${leg})`, () => {
  const makeLoan = async () => {
    const made = await createAccount(t.database, t.ada.id, adas, {
      type: 'loan',
      name: 'House',
      currency: 'USD',
      opening: { amount: -500_000, date: '2026-01-01' },
      loan: {
        lender: 'Lender',
        principal: 500_000,
        startDate: '2026-01-01',
        endDate: '2030-01-01',
        instalment: 10_000,
        yearlyRate: '5',
        interestSubcategoryId: null,
      },
    });
    if (!made.ok) throw new Error('not made');
    return made.id;
  };
  const make = (person: Person, loan: string, data: unknown, headers?: Record<string, string>) =>
    call(
      instalments,
      person,
      `/api/accounts/${loan}/instalments`,
      { method: 'POST', body: data, ...(headers ? { headers } : {}) },
      loan,
    );

  it('makes the instalments for the owner once, and says so the second time', async () => {
    const loan = await makeLoan();
    const body = { from: bank, firstDate: '2026-02-01', mode: 'auto' };
    expect((await make(t.ada, loan, body)).status).toBe(201);
    const again = await make(t.ada, loan, body);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { problems: string[] }).problems[0]).toContain(
      'instalments already',
    );
    expect((await listed(t.ada)).length).toBeGreaterThan(0);
  });

  it('is not found for another person, writing nothing, and refuses another address and a mistake', async () => {
    const loan = await makeLoan();
    const body = { from: bank, firstDate: '2026-02-01', mode: 'auto' };
    const strange = await make(t.grace, loan, body);
    expect(strange.status).toBe(404);
    expect(await strange.text()).toBe('');
    expect((await make(t.ada, loan, body, { origin: 'https://evil.example' })).status).toBe(403);
    for (const bad of [
      {},
      { ...body, from: 5 },
      { ...body, mode: 'maybe' },
      { ...body, firstDate: '2026-02-30' },
      { ...body, firstDate: '2040-01-01' },
    ]) {
      const reply = await make(t.ada, loan, bad);
      expect(reply.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await make(t.ada, loan, { ...body, from: 'nope' })).status).toBe(404);
    expect((await make(t.ada, loan, body)).status).toBe(201);
  });
});
