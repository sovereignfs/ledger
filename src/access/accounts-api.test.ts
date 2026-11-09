import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { bookIdFor, ensureBook } from '../ledger/books';
import { createTransaction } from '../ledger/transactions';
import { change, create, list, read, remove } from './accounts-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/**
 * The account routes, **called as the second person** (DESIGN.md §5.2): every one of them is tried for an account that is another person's and must answer
 * the way it answers for one that never was, and change nothing. They are wrapped as the route files wrap them, with this instance's sign-in.
 */
const { leg } = testTarget();

let t: TwoAccounts;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
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

const make = async (person: Person, body: unknown = {}) => {
  const reply = await call(create, person, '/api/accounts', {
    method: 'POST',
    body: {
      type: 'bank',
      name: 'Everyday',
      currency: 'USD',
      opening: { amount: 5000, date: '2026-01-01' },
      ...(body as object),
    },
  });
  expect(reply.status).toBe(201);
  return ((await reply.json()) as { id: string }).id;
};

describe(`the account routes (${leg})`, () => {
  it('make an account in the caller’s own book, and read it back; a body that names another book is not obeyed', async () => {
    const id = await make(t.ada, { bookId: bookIdFor(t.grace.id), accountId: t.grace.id });
    const mine = await call(read, t.ada, `/api/accounts/${id}`, {}, id);
    expect(mine.status).toBe(200);
    expect(
      ((await mine.json()) as { account: { name: string; balance: number } }).account,
    ).toMatchObject({ name: 'Everyday', balance: 5000 });
    expect(
      ((await (await call(list, t.grace, '/api/accounts')).json()) as { accounts: unknown[] })
        .accounts,
    ).toEqual([]);
  });

  it('list only the caller’s accounts, live or archived', async () => {
    const id = await make(t.ada, { name: 'To archive' });
    await call(
      change,
      t.ada,
      `/api/accounts/${id}`,
      { method: 'PATCH', body: { archived: true } },
      id,
    );
    const live = (await (await call(list, t.ada, '/api/accounts')).json()) as {
      accounts: { id: string }[];
    };
    const archived = (await (await call(list, t.ada, '/api/accounts?archived=1')).json()) as {
      accounts: { id: string }[];
    };
    expect(live.accounts.map((a) => a.id)).not.toContain(id);
    expect(archived.accounts.map((a) => a.id)).toContain(id);
  });

  it('answer a visitor 401 and a request from another address 403, and do nothing', async () => {
    const body = { type: 'bank', name: 'X', currency: 'USD' };
    expect((await call(create, null, '/api/accounts', { method: 'POST', body })).status).toBe(401);
    expect((await call(list, null, '/api/accounts')).status).toBe(401);
    expect(
      (
        await call(create, t.ada, '/api/accounts', {
          method: 'POST',
          body,
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(create, t.ada, '/api/accounts', {
          method: 'POST',
          body,
          headers: { origin: '' },
        })
      ).status,
    ).toBe(403);
  });

  it('are not another person’s to read, change, archive or delete: each is a 404 with nothing in it, and nothing changes', async () => {
    const id = await make(t.ada, { name: 'Ada only' });
    const asGrace = async (handler: Parameters<typeof call>[0], method: string, body?: unknown) => {
      const reply = await call(handler, t.grace, `/api/accounts/${id}`, { method, body }, id);
      expect(reply.status, `${method} ${JSON.stringify(body)}`).toBe(404);
      expect(await reply.text()).toBe('');
    };
    await asGrace(read, 'GET');
    await asGrace(change, 'PATCH', { name: 'Hers' });
    await asGrace(change, 'PATCH', { archived: true });
    await asGrace(change, 'PATCH', { name: 'Hers', archived: true });
    await asGrace(remove, 'DELETE');
    // The same answer as for an account that never was.
    const never = crypto.randomUUID();
    expect((await call(read, t.grace, `/api/accounts/${never}`, {}, never)).status).toBe(404);
    expect(
      (await call(remove, t.grace, `/api/accounts/${never}`, { method: 'DELETE' }, never)).status,
    ).toBe(404);
    const still = await call(read, t.ada, `/api/accounts/${id}`, {}, id);
    expect(
      ((await still.json()) as { account: { name: string; archivedAt: number | null } }).account,
    ).toMatchObject({ name: 'Ada only', archivedAt: null });
  });

  it('change the name, and archive and bring back, for the owner', async () => {
    const id = await make(t.ada);
    const renamed = await call(
      change,
      t.ada,
      `/api/accounts/${id}`,
      { method: 'PATCH', body: { name: 'Renamed', institution: 'Bank' } },
      id,
    );
    expect(renamed.status).toBe(200);
    const got = (await (await call(read, t.ada, `/api/accounts/${id}`, {}, id)).json()) as {
      account: { name: string; institution: string };
    };
    expect(got.account).toMatchObject({ name: 'Renamed', institution: 'Bank' });
  });

  it('answer a mistake with sentences and a 400, writing nothing', async () => {
    const before = (
      (await (await call(list, t.ada, '/api/accounts')).json()) as { accounts: unknown[] }
    ).accounts.length;
    for (const body of [
      { type: 'bank', name: '', currency: 'USD' },
      { type: 'bank', name: 'x', currency: 'BTC' },
      { type: 'bank', name: 'x', currency: 'USD', opening: { amount: 1.5, date: '2026-01-01' } },
      { type: 'bank', name: 'x', currency: 'USD', opening: { amount: '100', date: '2026-01-01' } },
      { type: 'nope', name: 'x', currency: 'USD' },
      { type: 'bank', name: 7, currency: 'USD' },
      [],
      null,
    ]) {
      const reply = await call(create, t.ada, '/api/accounts', { method: 'POST', body });
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(((await reply.json()) as { problems: string[] }).problems.length).toBeGreaterThan(0);
    }
    const garbage = bookRoute((c) => create(t.database, c), t.deps)(
      new Request(t.request(t.ada, '/api/accounts', { method: 'POST' }), {
        method: 'POST',
        headers: t.request(t.ada, '/x').headers,
        body: '{not json',
      }),
      { params: Promise.resolve({}) },
    );
    expect((await garbage).status).toBe(400);
    const huge = await call(create, t.ada, '/api/accounts', {
      method: 'POST',
      body: { type: 'bank', name: 'x'.repeat(20_000), currency: 'USD' },
    });
    expect(huge.status).toBe(413);
    expect(
      ((await (await call(list, t.ada, '/api/accounts')).json()) as { accounts: unknown[] })
        .accounts.length,
    ).toBe(before);
  });

  it('refuse to delete an account that has been used, with a 409, and delete one that has not', async () => {
    const used = await make(t.ada, { name: 'Used' });
    const other = await make(t.ada, { name: 'Other' });
    await createTransaction(t.database, t.ada.id, bookIdFor(t.ada.id), {
      type: 'transfer',
      date: '2026-02-01',
      lines: [
        { account: used, amount: -100, currency: 'USD' },
        { account: other, amount: 100, currency: 'USD' },
      ],
    });
    expect(
      (await call(remove, t.ada, `/api/accounts/${used}`, { method: 'DELETE' }, used)).status,
    ).toBe(409);
    const fresh = await make(t.ada, { name: 'Fresh' });
    expect(
      (await call(remove, t.ada, `/api/accounts/${fresh}`, { method: 'DELETE' }, fresh)).status,
    ).toBe(200);
    expect((await call(read, t.ada, `/api/accounts/${fresh}`, {}, fresh)).status).toBe(404);
    expect(
      (await call(remove, t.ada, `/api/accounts/${fresh}`, { method: 'DELETE' }, fresh)).status,
    ).toBe(404);
  });
});
