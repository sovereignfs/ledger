import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { bookIdFor, ensureBook } from '../ledger/books';
import { seedAccount, seedIncomeSource, seedSubcategory } from '../ledger/testing';
import { setArchived } from '../ledger/accounts';
import { balanceOf } from '../ledger/balances';
import { change, create, options, read, remove } from './transactions-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The entry routes, **called as the second person** (DESIGN.md §5.2): each answers for another person's entry as for one that never was, and changes nothing. */
const { leg } = testTarget();

let t: TwoAccounts;
let bank: string;
let food: string;
let pay: string;
let gracesBank: string;
let gracesFood: string;
beforeAll(async () => {
  t = await twoAccounts();
  const [ada, grace] = [bookIdFor(t.ada.id), bookIdFor(t.grace.id)];
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  bank = await seedAccount(t.database, ada, 'USD');
  food = await seedSubcategory(t.database, ada);
  pay = await seedIncomeSource(t.database, ada);
  gracesBank = await seedAccount(t.database, grace, 'USD');
  gracesFood = await seedSubcategory(t.database, grace);
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

const expense = (amount = 1250, over: object = {}) => ({
  type: 'expense',
  date: '2026-11-06',
  lines: [
    { account: bank, amount: -amount, currency: 'USD' },
    { subcategory: food, amount, currency: 'USD' },
  ],
  ...over,
});
const make = async (body: unknown = expense()) => {
  const reply = await call(create, t.ada, '/api/transactions', { method: 'POST', body });
  expect(reply.status).toBe(201);
  return ((await reply.json()) as { id: string }).id;
};
const balance = () => balanceOf(t.database, t.ada.id, bookIdFor(t.ada.id), bank);
const count = async () =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'txn')}`,
      )
    )[0]?.n,
  );

describe(`the entry routes (${leg})`, () => {
  it('offer the caller’s own accounts, subcategories and income sources, and today', async () => {
    const mine = (await (await call(options, t.ada, '/api/entry-options')).json()) as {
      today: string;
      accounts: { id: string }[];
      categories: { subcategories: { id: string }[] }[];
      incomeSources: { id: string }[];
    };
    expect(mine.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mine.accounts.map((a) => a.id)).toEqual([bank]);
    expect(mine.categories.flatMap((c) => c.subcategories.map((s) => s.id))).toEqual([food]);
    expect(mine.incomeSources.map((s) => s.id)).toEqual([pay]);
    const hers = (await (await call(options, t.grace, '/api/entry-options')).json()) as {
      accounts: { id: string }[];
    };
    expect(hers.accounts.map((a) => a.id)).toEqual([gracesBank]);
    expect((await call(options, null, '/api/entry-options')).status).toBe(401);
  });

  it('leave out an account that is archived, and the kinds of account an expense is not made on', async () => {
    const ada = bookIdFor(t.ada.id);
    const old = await seedAccount(t.database, ada, 'USD', 'savings', 'Old');
    const loan = await seedAccount(t.database, ada, 'USD', 'loan', 'Loan');
    const person = await seedAccount(t.database, ada, 'USD', 'person', 'Friend');
    const ids = async () =>
      (
        (await (await call(options, t.ada, '/api/entry-options')).json()) as {
          accounts: { id: string }[];
        }
      ).accounts.map((a) => a.id);
    expect((await ids()).sort()).toEqual([bank, old].sort());
    expect(await ids()).not.toContain(loan);
    expect(await ids()).not.toContain(person);
    await setArchived(t.database, t.ada.id, ada, old, true);
    expect(await ids()).toEqual([bank]);
  });

  it('write an entry in the caller’s book and read it back, and the balance moves', async () => {
    const before = await balance();
    const id = await make(expense(1250, { note: 'lunch', bookId: bookIdFor(t.grace.id) }));
    expect(await balance()).toBe(before - 1250);
    const got = (await (await call(read, t.ada, `/api/transactions/${id}`, {}, id)).json()) as {
      entry: { type: string; note: string; lines: { amount: number }[] };
    };
    expect(got.entry).toMatchObject({ type: 'expense', note: 'lunch' });
    expect(got.entry.lines.map((l) => l.amount)).toEqual([-1250, 1250]);
  });

  it('answer a visitor 401 and a request from another address 403, and write nothing', async () => {
    const before = await count();
    expect(
      (await call(create, null, '/api/transactions', { method: 'POST', body: expense() })).status,
    ).toBe(401);
    expect(
      (
        await call(create, t.ada, '/api/transactions', {
          method: 'POST',
          body: expense(),
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect(await count()).toBe(before);
  });

  it('are not another person’s to read, change or delete: each is a 404 with nothing in it, and nothing changes', async () => {
    const id = await make();
    const before = await balance();
    const hers = expense(5, {
      lines: [
        { account: gracesBank, amount: -5, currency: 'USD' },
        { subcategory: gracesFood, amount: 5, currency: 'USD' },
      ],
    });
    for (const [handler, method, payload] of [
      [read, 'GET', undefined],
      [change, 'PATCH', expense(7)],
      [change, 'PATCH', hers],
      [remove, 'DELETE', undefined],
    ] as const) {
      const reply = await call(
        handler,
        t.grace,
        `/api/transactions/${id}`,
        { method, body: payload },
        id,
      );
      expect(reply.status, method).toBe(404);
      expect(await reply.text(), method).toBe('');
    }
    // Writing into Ada’s accounts as Grace is the same answer.
    expect(
      (await call(create, t.grace, '/api/transactions', { method: 'POST', body: expense() }))
        .status,
    ).toBe(404);
    expect(await balance()).toBe(before);
    expect((await call(read, t.ada, `/api/transactions/${id}`, {}, id)).status).toBe(200);
  });

  it('change and delete for the owner, and a repeat of the delete is a 404', async () => {
    const id = await make();
    const before = await balance();
    expect(
      (
        await call(
          change,
          t.ada,
          `/api/transactions/${id}`,
          { method: 'PATCH', body: expense(300) },
          id,
        )
      ).status,
    ).toBe(200);
    expect(await balance()).toBe(before + 1250 - 300);
    expect(
      (await call(remove, t.ada, `/api/transactions/${id}`, { method: 'DELETE' }, id)).status,
    ).toBe(200);
    expect(await balance()).toBe(before + 1250);
    expect(
      (await call(remove, t.ada, `/api/transactions/${id}`, { method: 'DELETE' }, id)).status,
    ).toBe(404);
  });

  it('answer a mistake with sentences and a 400, writing nothing', async () => {
    const before = await count();
    const refused = async (body: unknown, fragment?: string) => {
      const reply = await call(create, t.ada, '/api/transactions', { method: 'POST', body });
      expect(reply.status, JSON.stringify(body)).toBe(400);
      const { problems } = (await reply.json()) as { problems: string[] };
      if (fragment) expect(problems.join(' ')).toContain(fragment);
    };
    await refused(
      expense(100, {
        lines: [
          { account: bank, amount: -100, currency: 'USD' },
          { subcategory: food, amount: 99, currency: 'USD' },
        ],
      }),
      'add up',
    );
    await refused(expense(100, { date: '2026-02-30' }), 'not a day');
    await refused(expense(100, { type: 'purchase' }));
    await refused(
      expense(100, {
        lines: [
          { account: bank, amount: '100', currency: 'USD' },
          { subcategory: food, amount: 100, currency: 'USD' },
        ],
      }),
    );
    await refused(
      expense(100, {
        lines: [
          { account: bank, amount: -1.5, currency: 'USD' },
          { subcategory: food, amount: 1.5, currency: 'USD' },
        ],
      }),
    );
    await refused({ ...expense(), note: 5 });
    await refused([]);
    await refused(null);
    expect(
      (
        await call(create, t.ada, '/api/transactions', {
          method: 'POST',
          body: { huge: 'x'.repeat(100_000) },
        })
      ).status,
    ).toBe(413);
    expect(await count()).toBe(before);
  });

  it('take an income, with its source', async () => {
    const reply = await call(create, t.ada, '/api/transactions', {
      method: 'POST',
      body: {
        type: 'income',
        date: '2026-11-01',
        lines: [
          { account: bank, amount: 5000, currency: 'USD' },
          { incomeSource: pay, amount: -5000, currency: 'USD' },
        ],
      },
    });
    expect(reply.status).toBe(201);
  });
});
