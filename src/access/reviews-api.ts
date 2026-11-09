import { todayIn } from '../dates';
import type { Database } from '../db/client';
import { findBook } from '../ledger/books';
import { reviewedMonths, setReviewed } from '../reports/review';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the review routes do (DESIGN.md §11.4), apart from the route files so that a test calls them as a second person. The account and the book are the session's and
 * nothing in a request names whose: **a review is the book's own**, so another person cannot mark, undo or read the months of a book that is not theirs.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const bad = (problem: string) => json({ problems: [problem] }, 400);

/** The months the person's book has reviewed. */
export async function list(database: Database, { accountId, bookId }: BookContext) {
  return json({ reviewed: [...(await reviewedMonths(database, accountId, bookId))] });
}

/** Marks a month reviewed, or undoes it: `{ month, reviewed: boolean }`. Idempotent. */
export async function mark(database: Database, { request, accountId, bookId }: BookContext) {
  const raw = await readCapped(request, 4 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad('The request is not JSON.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return bad('The request is not an object.');
  const { month, reviewed } = body as Record<string, unknown>;
  if (typeof month !== 'string' || typeof reviewed !== 'boolean')
    return bad('A review has a month and whether it is reviewed.');
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return new Response(null, { status: 404 });
  const result = await setReviewed(
    database,
    accountId,
    bookId,
    month,
    reviewed,
    todayIn(book.timeZone),
  );
  if (result.ok) return json({ month, reviewed });
  return result.reason === 'invalid'
    ? json({ problems: result.problems }, 400)
    : new Response(null, { status: 404 });
}
