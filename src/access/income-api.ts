import { isMonth, monthOf, todayIn } from '../dates';
import {
  createIncomeSource,
  deleteIncomeSource,
  listIncomeSources,
  makePrimary,
  renameIncomeSource,
  setIncomeSourceArchived,
} from '../budget/income-sources';
import { loadIncome } from '../budget/income';
import type { Database } from '../db/client';
import { findBook } from '../ledger/books';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the income routes do (DESIGN.md §7.4), apart from the route files so that a test calls them as a second person. The account and the book are the
 * session's and nothing in a request names whose; **an income source of another person is a 404 with nothing in it**, as one that never was.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });
const idOf = (params: BookContext['params']) => (typeof params.id === 'string' ? params.id : '');

async function body(request: Request): Promise<{ value: Record<string, unknown> } | Response> {
  const raw = await readCapped(request, 16 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return json({ problems: ['The request is not an object.'] }, 400);
    return { value: value as Record<string, unknown> };
  } catch {
    return json({ problems: ['The request is not JSON.'] }, 400);
  }
}

export async function list(database: Database, { accountId, bookId }: BookContext) {
  return json({ sources: await listIncomeSources(database, accountId, bookId) });
}

export async function create(database: Database, { request, accountId, bookId }: BookContext) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { name, kind, currency } = read.value;
  if (
    typeof name !== 'string' ||
    (kind !== undefined && typeof kind !== 'string') ||
    (currency != null && typeof currency !== 'string')
  )
    return json({ problems: ['The name, the kind and the currency are text.'] }, 400);
  const result = await createIncomeSource(database, accountId, bookId, {
    name,
    ...(kind === undefined ? {} : { kind: kind as 'primary' | 'secondary' }),
    currency: (currency as string | null | undefined) ?? null,
  });
  if (result.ok) return json({ id: result.id }, 201);
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
}

/** Renames a source, makes it the primary, archives it or brings it back: `{ name?, primary?: true, archived? }`. */
export async function change(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { name, primary, archived } = read.value;
  if (
    (name !== undefined && typeof name !== 'string') ||
    (primary !== undefined && primary !== true) ||
    (archived !== undefined && typeof archived !== 'boolean')
  )
    return json({ problems: ['That is not a change to an income source.'] }, 400);
  if (name === undefined && primary === undefined && archived === undefined)
    return json({ problems: ['There is nothing to change.'] }, 400);
  const id = idOf(params);
  if (typeof name === 'string') {
    const result = await renameIncomeSource(database, accountId, bookId, id, name);
    if (!result.ok)
      return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
  }
  if (primary === true && !(await makePrimary(database, accountId, bookId, id))) return notFound();
  if (typeof archived === 'boolean') {
    const result = await setIncomeSourceArchived(database, accountId, bookId, id, archived);
    if (result === 'not_found') return notFound();
    if (result === 'primary')
      return json(
        { problems: ['The primary income source is not archived. Make another primary first.'] },
        409,
      );
  }
  return json({ id });
}

export async function remove(database: Database, { accountId, bookId, params }: BookContext) {
  const result = await deleteIncomeSource(database, accountId, bookId, idOf(params));
  if (result === 'deleted') return json({ deleted: true });
  if (result === 'not_found') return notFound();
  return json(
    {
      problems: [
        result === 'primary'
          ? 'The primary income source is not deleted. Make another primary first.'
          : 'Income has been received from this source. Archive it instead.',
      ],
    },
    409,
  );
}

/** A month's income, budgeted and received apart, in the base currency with what was left out for want of a rate: `?month=YYYY-MM` (this month by the book's clock when none). */
export async function figures(database: Database, { request, accountId, bookId }: BookContext) {
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return notFound();
  const asked = new URL(request.url).searchParams.get('month');
  if (asked !== null && !isMonth(asked))
    return json({ problems: ['A month is written like 2026-11.'] }, 400);
  return json(
    await loadIncome(database, accountId, book, asked ?? monthOf(todayIn(book.timeZone))),
  );
}
