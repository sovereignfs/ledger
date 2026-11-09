import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { bookIdFor, ensureBook } from '../ledger/books';
import { seedAccount, seedIncomeSource, seedSubcategory } from '../ledger/testing';
import { setArchived } from '../ledger/accounts';
import { balanceOf } from '../ledger/balances';
import { createTransaction } from '../ledger/transactions';
import { bulk, change, create, options, read, remove } from './transactions-api';
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
      transferAccounts: { id: string }[];
      accounts: { id: string }[];
      categories: { subcategories: { id: string }[] }[];
      incomeSources: { id: string }[];
    };
    expect(mine.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mine.accounts.map((a) => a.id)).toEqual([bank]);
    expect(mine.transferAccounts.map((a) => a.id)).toContain(bank);
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

  it('take a split: 84.20 as 61.00 and 23.20 lands in both subcategories, and the account is down by the whole', async () => {
    const other = await seedSubcategory(t.database, bookIdFor(t.ada.id));
    const before = await balance();
    const id = await make({
      type: 'expense',
      date: '2026-11-06',
      lines: [
        { account: bank, amount: -8420, currency: 'USD' },
        { subcategory: food, amount: 6100, currency: 'USD' },
        { subcategory: other, amount: 2320, currency: 'USD' },
      ],
    });
    expect(await balance()).toBe(before - 8420);
    const entry = (
      (await (await call(read, t.ada, `/api/transactions/${id}`, {}, id)).json()) as {
        entry: { lines: { subcategory?: string; amount: number }[] };
      }
    ).entry;
    expect(entry.lines.filter((l) => l.subcategory).map((l) => [l.subcategory, l.amount])).toEqual([
      [food, 6100],
      [other, 2320],
    ]);
    // And one whose parts fall short is refused by the server too, with a sentence.
    const short = await call(create, t.ada, '/api/transactions', {
      method: 'POST',
      body: {
        type: 'expense',
        date: '2026-11-06',
        lines: [
          { account: bank, amount: -8420, currency: 'USD' },
          { subcategory: food, amount: 6100, currency: 'USD' },
          { subcategory: other, amount: 2000, currency: 'USD' },
        ],
      },
    });
    expect(short.status).toBe(400);
  });

  it('take a transfer: paying a card from checking changes both balances and spends nothing; EUR to USD keeps both amounts', async () => {
    const ada = bookIdFor(t.ada.id);
    const card = await seedAccount(t.database, ada, 'USD', 'credit_card', 'Card');
    const euro = await seedAccount(t.database, ada, 'EUR', 'bank', 'Euro');
    const before = await balance();
    const id = await make({
      type: 'transfer',
      date: '2026-11-06',
      lines: [
        { account: bank, amount: -25000, currency: 'USD' },
        { account: card, amount: 25000, currency: 'USD' },
      ],
    });
    expect(await balance()).toBe(before - 25000);
    expect(await balanceOf(t.database, t.ada.id, ada, card)).toBe(25000);
    const entry = (
      (await (await call(read, t.ada, `/api/transactions/${id}`, {}, id)).json()) as {
        entry: { type: string; lines: { subcategory?: string; incomeSource?: string }[] };
      }
    ).entry;
    expect(entry.type).toBe('transfer');
    expect(entry.lines.some((l) => l.subcategory || l.incomeSource)).toBe(false);
    await make({
      type: 'transfer',
      date: '2026-11-06',
      lines: [
        { account: bank, amount: -10000, currency: 'USD' },
        { account: euro, amount: 9000, currency: 'EUR' },
      ],
    });
    expect(await balanceOf(t.database, t.ada.id, ada, euro)).toBe(9000);
    expect(await balance()).toBe(before - 35000);
    // Both amounts the same way, or an amount in the wrong currency for its account, is refused.
    const wrong = async (lines: unknown) =>
      (
        await call(create, t.ada, '/api/transactions', {
          method: 'POST',
          body: { type: 'transfer', date: '2026-11-06', lines },
        })
      ).status;
    expect(
      await wrong([
        { account: bank, amount: -100, currency: 'USD' },
        { account: euro, amount: -90, currency: 'EUR' },
      ]),
    ).toBe(400);
    expect(
      await wrong([
        { account: bank, amount: -100, currency: 'USD' },
        { account: euro, amount: 90, currency: 'USD' },
      ]),
    ).toBe(400);
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

  it('do something to several at once, only to the caller’s own, and say how many were skipped', async () => {
    const mine = [await make(expense(100)), await make(expense(200))];
    const other = await seedSubcategory(t.database, bookIdFor(t.ada.id));
    const hers = await createTransaction(t.database, t.grace.id, bookIdFor(t.grace.id), {
      type: 'expense',
      date: '2026-11-06',
      lines: [
        { account: gracesBank, amount: -7, currency: 'USD' },
        { subcategory: gracesFood, amount: 7, currency: 'USD' },
      ],
    });
    if (!hers.ok) throw new Error('not written');
    const act = async (person: Person, body: unknown) =>
      call(bulk, person, '/api/transactions/bulk', { method: 'POST', body });
    const answer = async (reply: Response) =>
      (await reply.json()) as { changed: number; skipped: number };
    // Grace names Ada’s entries and her own: only her own is touched.
    expect(
      await answer(
        await act(t.grace, { action: 'status', ids: [...mine, hers.id], status: 'cleared' }),
      ),
    ).toEqual({ changed: 1, skipped: 2 });
    const statusOf = async (id: string, person: Person) =>
      (
        (await (await call(read, person, `/api/transactions/${id}`, {}, id)).json()) as {
          entry: { status: string };
        }
      ).entry.status;
    expect(await statusOf(mine[0] as string, t.ada)).toBe('pending');
    expect(await statusOf(hers.id, t.grace)).toBe('cleared');
    expect(
      await answer(await act(t.ada, { action: 'status', ids: mine, status: 'cleared' })),
    ).toEqual({ changed: 2, skipped: 0 });
    expect(
      await answer(
        await act(t.ada, { action: 'recategorise', ids: [...mine, hers.id], subcategoryId: other }),
      ),
    ).toEqual({ changed: 2, skipped: 1 });
    // Into a subcategory that is not hers.
    expect(
      await answer(
        await act(t.grace, { action: 'recategorise', ids: [hers.id], subcategoryId: other }),
      ),
    ).toEqual({ changed: 0, skipped: 1 });
    expect(await answer(await act(t.grace, { action: 'delete', ids: mine }))).toEqual({
      changed: 0,
      skipped: 2,
    });
    expect((await call(read, t.ada, `/api/transactions/${mine[0]}`, {}, mine[0])).status).toBe(200);
    expect(await answer(await act(t.ada, { action: 'delete', ids: mine }))).toEqual({
      changed: 2,
      skipped: 0,
    });
    expect((await call(read, t.ada, `/api/transactions/${mine[0]}`, {}, mine[0])).status).toBe(404);
    // Mistakes.
    for (const body of [
      {},
      { action: 'status', ids: [], status: 'cleared' },
      { action: 'status', ids: ['x'], status: 'done' },
      { action: 'delete', ids: 'x' },
      { action: 'delete', ids: [1] },
      { action: 'recategorise', ids: ['x'] },
      { action: 'delete', ids: Array.from({ length: 201 }, (_, i) => `id${i}`) },
      [],
    ])
      expect((await act(t.ada, body)).status, JSON.stringify(body)).toBe(400);
    expect(
      (
        await call(bulk, null, '/api/transactions/bulk', {
          method: 'POST',
          body: { action: 'delete', ids: ['x'] },
        })
      ).status,
    ).toBe(401);
  });
});
