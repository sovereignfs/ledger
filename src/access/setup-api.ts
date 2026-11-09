import type { Database } from '../db/client';
import { findBook } from '../ledger/books';
import {
  finishSetup,
  loadSetup,
  setupAccount,
  setupCategories,
  setupCurrency,
  setupIncome,
  type SetupResult,
} from '../setup/setup';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the setup route does (DESIGN.md §15.3), apart from the route file so that a test calls it as a second person. The account and the book are the session's
 * and nothing in a request names whose. Each step is one `POST` and is safe to repeat; the answer is what is done and what is next.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });

const answer = (result: SetupResult): Response =>
  result.ok
    ? json({ state: result.state })
    : result.reason === 'invalid'
      ? json({ problems: result.problems }, 400)
      : notFound();

/** What is done and what is next. */
export async function read(database: Database, { accountId, bookId }: BookContext) {
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return notFound();
  return json({ state: await loadSetup(database, accountId, book) });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const amountOf = (value: unknown): number | null | undefined =>
  value === null || value === undefined ? null : typeof value === 'number' ? value : undefined;

/**
 * One step: `{ step: 'currency', currency, timeZone? }`, `{ step: 'account', type, name, balance, date }`, `{ step: 'income', name, amount }`,
 * `{ step: 'categories', items: [{ name, amount }] }` or `{ step: 'done' }`.
 */
export async function write(database: Database, { request, accountId, bookId }: BookContext) {
  const raw = await readCapped(request, 16 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ problems: ['The request is not JSON.'] }, 400);
  }
  if (!isObject(body)) return json({ problems: ['The request is not a step.'] }, 400);
  const mistake = () => json({ problems: ['That is not a step of setup.'] }, 400);
  switch (body.step) {
    case 'currency': {
      if (
        typeof body.currency !== 'string' ||
        (body.timeZone !== undefined && typeof body.timeZone !== 'string')
      )
        return mistake();
      return answer(
        await setupCurrency(database, accountId, bookId, {
          currency: body.currency,
          ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone }),
        }),
      );
    }
    case 'account': {
      const balance = amountOf(body.balance);
      if (
        typeof body.type !== 'string' ||
        typeof body.name !== 'string' ||
        typeof body.date !== 'string' ||
        balance === undefined
      )
        return mistake();
      return answer(
        await setupAccount(database, accountId, bookId, {
          type: body.type,
          name: body.name,
          balance,
          date: body.date,
        }),
      );
    }
    case 'income': {
      const amount = amountOf(body.amount);
      if (typeof body.name !== 'string' || amount === undefined) return mistake();
      return answer(await setupIncome(database, accountId, bookId, { name: body.name, amount }));
    }
    case 'categories': {
      if (!Array.isArray(body.items)) return mistake();
      const items: { name: string; amount: number | null }[] = [];
      for (const item of body.items) {
        const amount = isObject(item) ? amountOf(item.amount) : undefined;
        if (!isObject(item) || typeof item.name !== 'string' || amount === undefined)
          return mistake();
        items.push({ name: item.name, amount });
      }
      return answer(await setupCategories(database, accountId, bookId, items));
    }
    case 'done':
      return answer(await finishSetup(database, accountId, bookId));
    default:
      return mistake();
  }
}
