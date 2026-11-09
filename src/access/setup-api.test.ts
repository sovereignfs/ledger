import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { ensureBook, findBook } from '../ledger/books';
import { read, write } from './setup-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The setup route, **called as the second person** (DESIGN.md §5.2): every step is for the caller's own book and nothing in a request names another. */
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
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  bookRoute((context) => handler(t.database, context), t.deps)(
    t.request(person, '/api/setup', init),
    { params: Promise.resolve({}) },
  );
const step = (person: Person | null, body: unknown, headers?: Record<string, string>) =>
  call(write, person, { method: 'POST', body, headers });
const state = async (person: Person) =>
  (
    (await (await call(read, person)).json()) as {
      state: {
        step: number;
        baseCurrency: string | null;
        done: boolean;
        account: { name: string } | null;
        subcategories: number;
      };
    }
  ).state;

describe(`the setup route (${leg})`, () => {
  it('goes through the four steps in the caller’s own book, and each answer says what is next', async () => {
    expect((await state(t.ada)).step).toBe(1);
    const one = await step(t.ada, { step: 'currency', currency: 'EUR', timeZone: 'Europe/Berlin' });
    expect(one.status).toBe(200);
    expect(((await one.json()) as { state: { step: number } }).state.step).toBe(2);
    expect(
      (
        await step(t.ada, {
          step: 'account',
          type: 'bank',
          name: 'Everyday',
          balance: 5_000,
          date: '2026-11-09',
        })
      ).status,
    ).toBe(200);
    expect((await step(t.ada, { step: 'income', name: 'Salary', amount: 300_000 })).status).toBe(
      200,
    );
    expect(
      (
        await step(t.ada, {
          step: 'categories',
          items: [
            { name: 'Groceries', amount: 40_000 },
            { name: 'Fun', amount: null },
          ],
        })
      ).status,
    ).toBe(200);
    expect(await state(t.ada)).toMatchObject({
      step: 4,
      baseCurrency: 'EUR',
      account: { name: 'Everyday' },
      subcategories: 2,
      done: false,
    });
    expect(
      ((await (await step(t.ada, { step: 'done' })).json()) as { state: { done: boolean } }).state
        .done,
    ).toBe(true);
  });

  it('leaves another person’s book alone: nothing in a request names it, and hers is its own', async () => {
    expect(await state(t.grace)).toMatchObject({
      step: 1,
      baseCurrency: null,
      account: null,
      done: false,
    });
    await step(t.grace, {
      step: 'currency',
      currency: 'JPY',
      bookId: (await findBook(t.database, t.ada.id))?.id,
      accountId: t.ada.id,
    });
    expect((await state(t.grace)).baseCurrency).toBe('JPY');
    expect((await state(t.ada)).baseCurrency).toBe('EUR');
  });

  it('answers a visitor 401 and a request from another address 403, and writes nothing', async () => {
    expect((await step(null, { step: 'done' })).status).toBe(401);
    expect(
      (
        await step(
          t.grace,
          { step: 'currency', currency: 'GBP' },
          { origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect((await call(read, null)).status).toBe(401);
    expect((await state(t.grace)).baseCurrency).toBe('JPY');
  });

  it('answers a mistake with sentences and a 400', async () => {
    const bad = async (body: unknown) => (await step(t.grace, body)).status;
    for (const body of [
      {},
      { step: 'nope' },
      { step: 'currency' },
      { step: 'currency', currency: 5 },
      { step: 'currency', currency: 'BTC' },
      { step: 'currency', currency: 'EUR', timeZone: 'Not/AZone' },
      { step: 'account', type: 'bank', name: 'x', balance: 'a', date: '2026-11-09' },
      { step: 'account', type: 'bank', date: '2026-11-09' },
      { step: 'income', name: 5 },
      { step: 'categories', items: 'x' },
      { step: 'categories', items: [{ name: 5 }] },
      [],
      null,
    ])
      expect(await bad(body), JSON.stringify(body)).toBe(400);
    expect(
      (await call(write, t.grace, { method: 'POST', body: { huge: 'x'.repeat(20_000) } })).status,
    ).toBe(413);
  });
});
