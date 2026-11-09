import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { ensureBook } from '../ledger/books';
import { change, create, figures, list, remove } from './income-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The income routes, **called as the second person** (DESIGN.md §5.2): another person's income source is a 404 with nothing in it, and nothing changes. */
const { leg } = testTarget();

let t: TwoAccounts;
beforeAll(async () => {
  t = await twoAccounts();
  for (const who of [t.ada, t.grace]) {
    const book = (await ensureBook(t.database, who.id)).id;
    await dbAll(
      t.database,
      sql`UPDATE ${tableNamed(t.database, 'book')} SET base_currency = 'USD' WHERE id = ${book} RETURNING id`,
    );
  }
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

const make = async (person: Person, name: string, kind?: string) => {
  const reply = await call(create, person, '/api/income-sources', {
    method: 'POST',
    body: { name, kind },
  });
  expect(reply.status).toBe(201);
  return ((await reply.json()) as { id: string }).id;
};
const sources = async (person: Person) =>
  (
    (await (await call(list, person, '/api/income-sources')).json()) as {
      sources: { id: string; name: string; kind: string }[];
    }
  ).sources;

describe(`the income routes (${leg})`, () => {
  it('make sources in the caller’s own book, the first primary, and list them; another person lists none of them', async () => {
    await make(t.ada, 'Salary');
    await make(t.ada, 'Side work');
    expect((await sources(t.ada)).map((s) => [s.name, s.kind])).toEqual([
      ['Salary', 'primary'],
      ['Side work', 'secondary'],
    ]);
    expect(await sources(t.grace)).toEqual([]);
    expect((await call(list, null, '/api/income-sources')).status).toBe(401);
  });

  it('answer a request from another address 403, and a mistake with sentences and a 400, writing nothing', async () => {
    expect(
      (
        await call(create, t.ada, '/api/income-sources', {
          method: 'POST',
          body: { name: 'X' },
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    for (const body of [
      {},
      { name: 5 },
      { name: '' },
      { name: 'x', kind: 'tertiary' },
      { name: 'x', currency: 'BTC' },
      [],
      null,
    ])
      expect(
        (await call(create, t.ada, '/api/income-sources', { method: 'POST', body })).status,
        JSON.stringify(body),
      ).toBe(400);
    const primary = await call(create, t.ada, '/api/income-sources', {
      method: 'POST',
      body: { name: 'Second primary', kind: 'primary' },
    });
    expect(primary.status).toBe(400);
    expect(((await primary.json()) as { problems: string[] }).problems[0]).toContain(
      'primary income source already',
    );
    expect((await sources(t.ada)).map((s) => s.name)).toEqual(['Salary', 'Side work']);
  });

  it('rename, make primary, archive and delete, for the owner, and the primary is kept with a 409', async () => {
    const side = (await sources(t.ada)).find((s) => s.name === 'Side work')?.id as string;
    const salary = (await sources(t.ada)).find((s) => s.name === 'Salary')?.id as string;
    expect(
      (
        await call(
          change,
          t.ada,
          `/api/income-sources/${side}`,
          { method: 'PATCH', body: { name: 'Freelance' } },
          side,
        )
      ).status,
    ).toBe(200);
    const kept = await call(
      remove,
      t.ada,
      `/api/income-sources/${salary}`,
      { method: 'DELETE' },
      salary,
    );
    expect(kept.status).toBe(409);
    expect(
      (
        await call(
          change,
          t.ada,
          `/api/income-sources/${salary}`,
          { method: 'PATCH', body: { archived: true } },
          salary,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          change,
          t.ada,
          `/api/income-sources/${side}`,
          { method: 'PATCH', body: { primary: true } },
          side,
        )
      ).status,
    ).toBe(200);
    expect((await sources(t.ada)).map((s) => [s.name, s.kind])).toEqual([
      ['Freelance', 'primary'],
      ['Salary', 'secondary'],
    ]);
    expect(
      (await call(remove, t.ada, `/api/income-sources/${salary}`, { method: 'DELETE' }, salary))
        .status,
    ).toBe(200);
    expect(
      (await call(remove, t.ada, `/api/income-sources/${salary}`, { method: 'DELETE' }, salary))
        .status,
    ).toBe(404);
    for (const body of [{}, { name: 5 }, { primary: false }, { archived: 'yes' }])
      expect(
        (await call(change, t.ada, `/api/income-sources/${side}`, { method: 'PATCH', body }, side))
          .status,
        JSON.stringify(body),
      ).toBe(400);
  });

  it('are not another person’s to rename, make primary, archive or delete: each is a 404 with nothing in it', async () => {
    const mine = await make(t.ada, 'Ada private');
    const before = JSON.stringify(await sources(t.ada));
    for (const [handler, method, body] of [
      [change, 'PATCH', { name: 'Hers' }],
      [change, 'PATCH', { primary: true }],
      [change, 'PATCH', { archived: true }],
      [remove, 'DELETE', undefined],
    ] as const) {
      const reply = await call(
        handler,
        t.grace,
        `/api/income-sources/${mine}`,
        { method, body },
        mine,
      );
      expect(reply.status, JSON.stringify(body)).toBe(404);
      expect(await reply.text()).toBe('');
    }
    expect(JSON.stringify(await sources(t.ada))).toBe(before);
  });

  it('give a month’s income for the caller only, and refuse a month that is not one', async () => {
    const mine = (await (await call(figures, t.ada, '/api/income?month=2026-11')).json()) as {
      month: string;
      rows: { source: { name: string } }[];
      received: { amount: number };
    };
    expect(mine.month).toBe('2026-11');
    expect(mine.rows.length).toBeGreaterThan(0);
    const hers = (await (await call(figures, t.grace, '/api/income?month=2026-11')).json()) as {
      rows: unknown[];
    };
    expect(hers.rows).toEqual([]);
    expect((await call(figures, t.ada, '/api/income?month=2026-13')).status).toBe(400);
    expect((await call(figures, t.ada, '/api/income')).status).toBe(200);
    expect((await call(figures, null, '/api/income')).status).toBe(401);
  });
});
