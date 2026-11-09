import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { ensureBook } from '../ledger/books';
import { change, create, list, movement } from './jars-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The jar routes, **called as the second person** (DESIGN.md §5.2): another person's jar is a 404 with nothing in it, and nothing changes. */
const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
let savings: string;
let hers: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  const open = async (who: Person, book: string) => {
    const made = await createAccount(t.database, who.id, book, {
      type: 'savings',
      name: 'Savings',
      currency: 'USD',
      opening: { amount: 100_000, date: '2026-01-01' },
    });
    if (!made.ok) throw new Error('not made');
    return made.id;
  };
  savings = await open(t.ada, adas);
  hers = await open(t.grace, graces);
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

const make = async (name: string, extra: Record<string, unknown> = {}) => {
  const reply = await call(create, t.ada, '/api/jars', {
    method: 'POST',
    body: { accountId: savings, name, ...extra },
  });
  expect(reply.status).toBe(201);
  return ((await reply.json()) as { id: string }).id;
};
const listed = async (person: Person) =>
  (await (await call(list, person, '/api/jars')).json()) as {
    jars: { id: string; name: string; balance: number }[];
    accounts: {
      id: string;
      balance: number;
      inJars: number;
      free: number;
      overEarmarked: boolean;
    }[];
  };

describe(`the jar routes (${leg})`, () => {
  it('make a jar in the caller’s own account, move money in and out, and say what is free; another person sees none of it', async () => {
    const id = await make('Travel', { target: 300_000, monthly: 15_000 });
    const earmark = await call(
      movement,
      t.ada,
      `/api/jars/${id}/movements`,
      { method: 'POST', body: { direction: 'earmark', amount: 40_000 } },
      id,
    );
    expect(earmark.status).toBe(201);
    const seen = await listed(t.ada);
    expect(seen.jars.find((j) => j.id === id)).toMatchObject({ name: 'Travel', balance: 40_000 });
    expect(seen.accounts.find((a) => a.id === savings)).toMatchObject({
      balance: 100_000,
      inJars: 40_000,
      free: 60_000,
      overEarmarked: false,
    });
    const released = await call(
      movement,
      t.ada,
      `/api/jars/${id}/movements`,
      { method: 'POST', body: { direction: 'release', amount: 10_000, date: '2026-11-02' } },
      id,
    );
    expect(released.status).toBe(201);
    expect((await listed(t.ada)).jars.find((j) => j.id === id)?.balance).toBe(30_000);
    expect(await listed(t.grace)).toEqual({ jars: [], accounts: [] });
    expect((await call(list, null, '/api/jars')).status).toBe(401);
  });

  it('refuse more than is free or held with a sentence and a 400, and write nothing', async () => {
    const id = await make('Small');
    const more = await call(
      movement,
      t.ada,
      `/api/jars/${id}/movements`,
      { method: 'POST', body: { direction: 'earmark', amount: 99_999_999 } },
      id,
    );
    expect(more.status).toBe(400);
    expect(((await more.json()) as { problems: string[] }).problems[0]).toContain(
      'not that much free',
    );
    const over = await call(
      movement,
      t.ada,
      `/api/jars/${id}/movements`,
      { method: 'POST', body: { direction: 'release', amount: 1 } },
      id,
    );
    expect(over.status).toBe(400);
    expect((await listed(t.ada)).jars.find((j) => j.id === id)?.balance).toBe(0);
  });

  it('answer another address 403 and a mistake with a 400', async () => {
    const id = await make('Checked');
    const path = `/api/jars/${id}/movements`;
    expect(
      (
        await call(
          movement,
          t.ada,
          path,
          {
            method: 'POST',
            body: { direction: 'earmark', amount: 1 },
            headers: { origin: 'https://evil.example' },
          },
          id,
        )
      ).status,
    ).toBe(403);
    for (const body of [
      {},
      { direction: 'earmark' },
      { direction: 'sideways', amount: 1 },
      { direction: 'earmark', amount: '1' },
      { direction: 'earmark', amount: 0 },
      { direction: 'earmark', amount: 1, date: 5 },
      { direction: 'earmark', amount: 1, date: 'soon' },
      [],
    ])
      expect(
        (await call(movement, t.ada, path, { method: 'POST', body }, id)).status,
        JSON.stringify(body),
      ).toBe(400);
    for (const body of [
      {},
      { name: 5 },
      { name: '' },
      { target: 'x' },
      { target: 0 },
      { archived: 'yes' },
      [],
    ])
      expect(
        (
          await call(create, t.ada, '/api/jars', {
            method: 'POST',
            body: { accountId: savings, name: 'N', ...(Array.isArray(body) ? {} : body) },
          })
        ).status,
        JSON.stringify(body),
      ).toBe(body && !Array.isArray(body) && Object.keys(body).length === 0 ? 201 : 400);
    expect((await call(create, t.ada, '/api/jars', { method: 'POST', body: [] })).status).toBe(400);
  });

  it('change a jar for its owner, and for another person it is not found and nothing changes', async () => {
    const id = await make('Changeable');
    const path = `/api/jars/${id}`;
    for (const body of [{ name: 'Hers' }, { archived: true }, { accountId: hers }, { target: 5 }]) {
      const reply = await call(change, t.grace, path, { method: 'PATCH', body }, id);
      expect(reply.status, JSON.stringify(body)).toBe(404);
      expect(await reply.text()).toBe('');
    }
    const strange = await call(
      movement,
      t.grace,
      `${path}/movements`,
      { method: 'POST', body: { direction: 'earmark', amount: 1 } },
      id,
    );
    expect(strange.status).toBe(404);
    expect(
      (
        await call(
          change,
          t.ada,
          path,
          { method: 'PATCH', body: { name: 'Renamed', target: 9_000 } },
          id,
        )
      ).status,
    ).toBe(200);
    expect(
      (await call(change, t.ada, path, { method: 'PATCH', body: { accountId: hers } }, id)).status,
    ).toBe(404);
    expect((await call(change, t.ada, path, { method: 'PATCH', body: {} }, id)).status).toBe(400);
    expect(
      (await call(change, t.ada, path, { method: 'PATCH', body: { archived: true } }, id)).status,
    ).toBe(200);
    expect((await listed(t.ada)).jars.find((j) => j.id === id)).toBeUndefined();
  });

  it('refuse a jar in another person’s account as not found', async () => {
    const reply = await call(create, t.ada, '/api/jars', {
      method: 'POST',
      body: { accountId: hers, name: 'Sneaky' },
    });
    expect(reply.status).toBe(404);
    expect(await reply.text()).toBe('');
  });
});
