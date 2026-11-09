import type { Database } from '../db/client';
import { findBook } from '../ledger/books';
import { type BookPatch, updateBook } from '../ledger/book-settings';
import { addCurrency, listCurrencies } from '../ledger/currencies';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the book's settings routes do (DESIGN.md §15.1), apart from the route files so that a test calls them as a second person. The account and the book are the
 * session's and nothing in a request names whose, so there is no other person's book to ask for.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const bad = (problem: string) => json({ problems: [problem] }, 400);

/** The book's settings and the currencies it uses. */
export async function read(database: Database, { accountId, bookId }: BookContext) {
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return new Response(null, { status: 404 });
  return json({ book, currencies: await listCurrencies(database, accountId, bookId) });
}

/** Changes the book's settings: `{ name?, baseCurrency?, timeZone?, firstDayOfWeek?, locale?, recap? }`. Only what is given changes. */
export async function change(database: Database, { request, accountId, bookId }: BookContext) {
  const raw = await readCapped(request, 8 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad('The request is not JSON.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return bad('The request is not an object.');
  const { name, baseCurrency, timeZone, firstDayOfWeek, locale, recap } = body as Record<
    string,
    unknown
  >;
  const patch: { -readonly [K in keyof BookPatch]: BookPatch[K] } = {};
  if (name !== undefined) {
    if (typeof name !== 'string') return bad('The name is text.');
    patch.name = name;
  }
  if (baseCurrency !== undefined) {
    if (typeof baseCurrency !== 'string') return bad('Choose a currency.');
    patch.baseCurrency = baseCurrency;
  }
  if (timeZone !== undefined) {
    if (typeof timeZone !== 'string') return bad('The time zone is not one.');
    patch.timeZone = timeZone;
  }
  if (firstDayOfWeek !== undefined) {
    if (typeof firstDayOfWeek !== 'number') return bad('The first day of the week is a number.');
    patch.firstDayOfWeek = firstDayOfWeek;
  }
  if (locale !== undefined) {
    if (locale !== null && typeof locale !== 'string')
      return bad('The locale is text, or nothing.');
    patch.locale = locale;
  }
  if (recap !== undefined) {
    if (typeof recap !== 'boolean') return bad('The recap is on or off.');
    patch.recap = recap;
  }
  if (Object.keys(patch).length === 0) return bad('There is nothing to change.');
  const result = await updateBook(database, accountId, bookId, patch);
  if (result.ok) return json({ id: result.id });
  return result.reason === 'invalid'
    ? json({ problems: result.problems }, 400)
    : new Response(null, { status: 404 });
}

/** Adds a currency to the book's currencies, which are the ones the rates are fetched for: `{ code }`. Adding one that is there changes nothing. */
export async function addBookCurrency(
  database: Database,
  { request, accountId, bookId }: BookContext,
) {
  const raw = await readCapped(request, 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad('The request is not JSON.');
  }
  const code =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).code
      : undefined;
  if (typeof code !== 'string') return bad('Choose a currency.');
  const result = await addCurrency(database, accountId, bookId, code);
  if (result === 'unsupported') return bad('Choose a currency.');
  if (result === 'not_found') return new Response(null, { status: 404 });
  return json({ code, added: result === 'added' }, result === 'added' ? 201 : 200);
}
