import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { ensureBook } from '../ledger/books';
import {
  addSubcategory,
  changeCategory,
  changeSubcategory,
  create,
  list,
  removeCategory,
  removeSubcategory,
  reorder,
} from './categories-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The category routes, **called as the second person** (DESIGN.md §5.2): each answers for another person's category as for one that never was, and changes nothing. */
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

const post = async (person: Person, body: unknown) =>
  call(create, person, '/api/categories', { method: 'POST', body });
const make = async (person: Person, name: string) => {
  const reply = await post(person, { name, currency: 'USD' });
  expect(reply.status).toBe(201);
  return ((await reply.json()) as { id: string }).id;
};
const names = async (person: Person) =>
  (
    (await (await call(list, person, '/api/categories')).json()) as {
      categories: { name: string; subcategories: { name: string }[] }[];
    }
  ).categories;

describe(`the category routes (${leg})`, () => {
  it('make a category and a subcategory in the caller’s own book and list them; a body that names a book is not obeyed', async () => {
    const id = await make(t.ada, 'Home');
    const sub = await call(
      addSubcategory,
      t.ada,
      `/api/categories/${id}/subcategories`,
      { method: 'POST', body: { name: 'Rent', bookId: 'x', accountId: t.grace.id } },
      id,
    );
    expect(sub.status).toBe(201);
    expect(
      (await names(t.ada)).find((c) => c.name === 'Home')?.subcategories.map((s) => s.name),
    ).toEqual(['Rent']);
    expect(await names(t.grace)).toEqual([]);
  });

  it('answer a visitor 401 and a request from another address 403', async () => {
    const body = { name: 'X', currency: 'USD' };
    expect((await call(create, null, '/api/categories', { method: 'POST', body })).status).toBe(
      401,
    );
    expect(
      (
        await call(create, t.ada, '/api/categories', {
          method: 'POST',
          body,
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
  });

  it('are not another person’s to change, order, archive or delete: each is a 404 with nothing in it, and nothing changes', async () => {
    const id = await make(t.ada, 'Ada only');
    const subReply = await call(
      addSubcategory,
      t.ada,
      `/api/categories/${id}/subcategories`,
      { method: 'POST', body: { name: 'Ada sub' } },
      id,
    );
    const subId = ((await subReply.json()) as { id: string }).id;
    const before = JSON.stringify(await names(t.ada));
    const expect404 = async (reply: Response, what: string) => {
      expect(reply.status, what).toBe(404);
      expect(await reply.text(), what).toBe('');
    };
    await expect404(
      await call(
        changeCategory,
        t.grace,
        `/api/categories/${id}`,
        { method: 'PATCH', body: { name: 'Hers' } },
        id,
      ),
      'rename',
    );
    await expect404(
      await call(
        changeCategory,
        t.grace,
        `/api/categories/${id}`,
        { method: 'PATCH', body: { archived: true } },
        id,
      ),
      'archive',
    );
    await expect404(
      await call(
        changeCategory,
        t.grace,
        `/api/categories/${id}`,
        { method: 'PATCH', body: { order: [subId] } },
        id,
      ),
      'order',
    );
    await expect404(
      await call(removeCategory, t.grace, `/api/categories/${id}`, { method: 'DELETE' }, id),
      'delete',
    );
    await expect404(
      await call(
        addSubcategory,
        t.grace,
        `/api/categories/${id}/subcategories`,
        { method: 'POST', body: { name: 'Hers' } },
        id,
      ),
      'add sub',
    );
    await expect404(
      await call(
        changeSubcategory,
        t.grace,
        `/api/subcategories/${subId}`,
        { method: 'PATCH', body: { name: 'Hers' } },
        subId,
      ),
      'rename sub',
    );
    await expect404(
      await call(
        changeSubcategory,
        t.grace,
        `/api/subcategories/${subId}`,
        { method: 'PATCH', body: { archived: true } },
        subId,
      ),
      'archive sub',
    );
    await expect404(
      await call(
        removeSubcategory,
        t.grace,
        `/api/subcategories/${subId}`,
        { method: 'DELETE' },
        subId,
      ),
      'delete sub',
    );
    await expect404(
      await call(reorder, t.grace, '/api/categories', { method: 'PUT', body: { order: [id] } }),
      'reorder',
    );
    // The same answer as for what never was.
    const never = crypto.randomUUID();
    await expect404(
      await call(removeCategory, t.grace, `/api/categories/${never}`, { method: 'DELETE' }, never),
      'never',
    );
    expect(JSON.stringify(await names(t.ada))).toBe(before);
  });

  it('rename, archive, order and delete, for the owner', async () => {
    const a = await make(t.ada, 'First');
    const b = await make(t.ada, 'Second');
    expect(
      (
        await call(
          changeCategory,
          t.ada,
          `/api/categories/${a}`,
          { method: 'PATCH', body: { name: 'Renamed' } },
          a,
        )
      ).status,
    ).toBe(200);
    expect(
      (await call(reorder, t.ada, '/api/categories', { method: 'PUT', body: { order: [b, a] } }))
        .status,
    ).toBe(200);
    const order = (await names(t.ada)).map((c) => c.name);
    expect(order.indexOf('Second')).toBeLessThan(order.indexOf('Renamed'));
    expect(
      (
        await call(
          changeCategory,
          t.ada,
          `/api/categories/${a}`,
          { method: 'PATCH', body: { archived: true } },
          a,
        )
      ).status,
    ).toBe(200);
    expect(
      (await call(removeCategory, t.ada, `/api/categories/${b}`, { method: 'DELETE' }, b)).status,
    ).toBe(200);
    expect((await names(t.ada)).map((c) => c.name)).not.toContain('Second');
    expect(
      (await call(removeCategory, t.ada, `/api/categories/${b}`, { method: 'DELETE' }, b)).status,
    ).toBe(404);
  });

  it('answer a mistake with sentences and a 400, writing nothing', async () => {
    const before = (await names(t.ada)).length;
    for (const body of [
      { name: '' },
      { name: 5 },
      { name: 'x', currency: 7 },
      { name: 'x', currency: 'BTC' },
      [],
      null,
      'text',
    ])
      expect((await post(t.ada, body)).status, JSON.stringify(body)).toBe(400);
    const id = await make(t.ada, 'For mistakes');
    for (const body of [{}, { name: 3 }, { archived: 'yes' }, { order: 'a' }, { order: [1] }])
      expect(
        (await call(changeCategory, t.ada, `/api/categories/${id}`, { method: 'PATCH', body }, id))
          .status,
        JSON.stringify(body),
      ).toBe(400);
    expect((await post(t.ada, { name: 'for mistakes', currency: 'USD' })).status).toBe(400);
    expect(
      (
        await call(create, t.ada, '/api/categories', {
          method: 'POST',
          body: { name: 'x'.repeat(20_000) },
        })
      ).status,
    ).toBe(413);
    expect((await names(t.ada)).length).toBe(before + 1);
  });
});
