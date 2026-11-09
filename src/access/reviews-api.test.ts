import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { ensureBook } from '../ledger/books';
import { list, mark } from './reviews-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The review routes, **called as the second person** (DESIGN.md §5.2): a review is the book's own, and what another person sends changes nothing of it. */
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
) =>
  bookRoute((context) => handler(t.database, context), t.deps)(t.request(person, path, init), {
    params: Promise.resolve({}),
  });
const reviewed = async (person: Person) =>
  ((await (await call(list, person, '/api/reviews')).json()) as { reviewed: string[] }).reviewed;
const set = (person: Person | null, body: unknown, headers?: Record<string, string>) =>
  call(mark, person, '/api/reviews', { method: 'POST', body, ...(headers ? { headers } : {}) });

describe(`the review routes (${leg})`, () => {
  it('mark a past month for the caller’s own book, twice as once, undo it, and show only that book’s', async () => {
    expect((await set(t.ada, { month: '2020-01', reviewed: true })).status).toBe(200);
    expect((await set(t.ada, { month: '2020-01', reviewed: true })).status).toBe(200);
    expect(await reviewed(t.ada)).toEqual(['2020-01']);
    expect(await reviewed(t.grace)).toEqual([]);
    expect((await set(t.grace, { month: '2020-01', reviewed: true })).status).toBe(200);
    expect(await reviewed(t.grace)).toEqual(['2020-01']);
    expect((await set(t.ada, { month: '2020-01', reviewed: false })).status).toBe(200);
    expect(await reviewed(t.ada)).toEqual([]);
    expect(await reviewed(t.grace)).toEqual(['2020-01']);
    expect((await call(list, null, '/api/reviews')).status).toBe(401);
  });

  it('refuse a month that is not over, a mistake and another address, with sentences, writing nothing', async () => {
    const before = await reviewed(t.ada);
    const future = await set(t.ada, { month: '2999-01', reviewed: true });
    expect(future.status).toBe(400);
    expect(((await future.json()) as { problems: string[] }).problems[0]).toContain('over');
    for (const body of [
      {},
      { month: 5, reviewed: true },
      { month: '2020-01' },
      { month: '2020-01', reviewed: 'yes' },
      { month: 'soon', reviewed: true },
      [],
      null,
    ])
      expect((await set(t.ada, body)).status, JSON.stringify(body)).toBe(400);
    expect(
      (await set(t.ada, { month: '2020-02', reviewed: true }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(await reviewed(t.ada)).toEqual(before);
  });
});
