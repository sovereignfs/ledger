import { todayIn } from '../dates';
import type { Database } from '../db/client';
import { findBook } from '../ledger/books';
import { exportBook } from '../portability/format';
import { importBook } from '../portability/import';
import type { Notifier } from '../notifications/server';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the export and import routes do (DESIGN.md §16), apart from the route files so that a test calls them as a second person. The account and the book are the session's
 * and nothing in a request names whose: **an export is the caller's own book alone**, and an import goes into the caller's own book, if it is empty.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The most a file may be: a book of years is a few megabytes. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** Names a download after the book and the day, with nothing in it a file name cannot hold. */
export function fileNameFor(bookName: string, day: string): string {
  const slug = bookName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `ledger-${slug === '' ? 'book' : slug}-${day}.json`;
}

/** The book as a file to download. */
export async function download(
  database: Database,
  { accountId, bookId }: BookContext,
  activity?: Notifier['activity'],
) {
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return new Response(null, { status: 404 });
  const file = await exportBook(database, accountId, bookId);
  if (!file) return new Response(null, { status: 404 });
  // A line on the person's activity page at core, if there is one: what was done and where, with no figure of the book. Never held up for, and never a reason for it to fail.
  void activity?.({
    accountId,
    summary: 'You exported your book',
    path: '/account?section=data',
    key: `export-${Date.now()}`,
  }).catch(() => undefined);
  return new Response(JSON.stringify(file), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${fileNameFor(book.name, todayIn(book.timeZone))}"`,
      'cache-control': 'no-store',
    },
  });
}

/** Imports a file into the person's own book, which must be empty: the body is the file. */
export async function upload(
  database: Database,
  { request, accountId, bookId }: BookContext,
  activity?: Notifier['activity'],
) {
  const text = await readCapped(request, MAX_IMPORT_BYTES);
  if (text === null) return json({ problems: ['That file is too large.'] }, 413);
  const result = await importBook(database, accountId, bookId, text);
  if (result.ok) {
    void activity?.({
      accountId,
      summary: 'You imported a file into your book',
      path: '/account?section=data',
      key: `import-${Date.now()}`,
    }).catch(() => undefined);
    return json({ rows: result.rows }, 201);
  }
  if (result.reason === 'invalid') return json({ problems: result.problems }, 400);
  if (result.reason === 'not_empty')
    return json(
      {
        problems: [
          'A file is imported into an empty book, and this one has things in it. Delete everything first, or import it into a new account.',
        ],
      },
      409,
    );
  return new Response(null, { status: 404 });
}
