import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { findBook, ensureBook, type Book } from '../ledger/books';
import { addBookCurrency, change, read } from './book-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The book's settings routes, **called as the second person** (DESIGN.md §5.2): each person's request is for their own book and changes nothing of the other's. */
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
const patch = (person: Person | null, body: unknown, headers?: Record<string, string>) =>
  call(change, person, '/api/book', { method: 'PATCH', body, ...(headers ? { headers } : {}) });

describe(`the book routes (${leg})`, () => {
  it('read the caller’s own book and its currencies, and change only it', async () => {
    const mine = (await (await call(read, t.ada, '/api/book')).json()) as {
      book: Book;
      currencies: string[];
    };
    expect(mine.book.name).toBe('My budget');
    const graces = (await findBook(t.database, t.grace.id)) as Book;
    expect(
      (
        await patch(t.ada, {
          name: 'Ada’s',
          timeZone: 'Europe/London',
          baseCurrency: 'GBP',
          firstDayOfWeek: 0,
          locale: 'en-GB',
          recap: false,
        })
      ).status,
    ).toBe(200);
    const after = (await (await call(read, t.ada, '/api/book')).json()) as {
      book: Book;
      currencies: string[];
    };
    expect(after.book).toMatchObject({
      name: 'Ada’s',
      timeZone: 'Europe/London',
      baseCurrency: 'GBP',
      firstDayOfWeek: 0,
      locale: 'en-GB',
      recap: false,
    });
    expect(after.currencies).toContain('GBP');
    expect(await findBook(t.database, t.grace.id)).toEqual(graces);
    expect((await call(read, null, '/api/book')).status).toBe(401);
  });

  it('refuse a mistake with sentences and a 400, writing nothing, and another address with a 403', async () => {
    const before = (await findBook(t.database, t.ada.id)) as Book;
    for (const body of [
      {},
      { name: 5 },
      { name: '' },
      { baseCurrency: 'BTC' },
      { baseCurrency: 5 },
      { timeZone: 'Mars/Olympus' },
      { firstDayOfWeek: 9 },
      { firstDayOfWeek: '1' },
      { locale: 'nope nope' },
      { locale: 5 },
      { recap: 'yes' },
      [],
      null,
    ]) {
      const reply = await patch(t.ada, body);
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(((await reply.json()) as { problems: string[] }).problems.length).toBeGreaterThan(0);
    }
    expect((await patch(t.ada, { name: 'X' }, { origin: 'https://evil.example' })).status).toBe(
      403,
    );
    expect(await findBook(t.database, t.ada.id)).toEqual(before);
  });

  it('add a currency to the caller’s own book, once, and refuse one that is not a currency', async () => {
    const add = (person: Person, code: unknown) =>
      call(addBookCurrency, person, '/api/book/currencies', { method: 'POST', body: { code } });
    expect((await add(t.ada, 'JPY')).status).toBe(201);
    expect((await add(t.ada, 'JPY')).status).toBe(200);
    expect((await add(t.ada, 'BTC')).status).toBe(400);
    expect((await add(t.ada, 5)).status).toBe(400);
    const mine = (await (await call(read, t.ada, '/api/book')).json()) as { currencies: string[] };
    const hers = (await (await call(read, t.grace, '/api/book')).json()) as {
      currencies: string[];
    };
    expect(mine.currencies).toContain('JPY');
    expect(hers.currencies).not.toContain('JPY');
  });
});
