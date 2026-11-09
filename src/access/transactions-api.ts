import type { Database } from '../db/client';
import { bulkDelete, bulkRecategorise, bulkSetStatus } from '../ledger/bulk';
import { getEntry, loadEntryOptions } from '../ledger/entries';
import { createTransaction, deleteTransaction, updateTransaction } from '../ledger/transactions';
import { todayIn } from '../dates';
import { findBook } from '../ledger/books';
import { readCapped } from './body';
import type { BookContext } from './route';
import { parseTxnInput } from './txn-input';

/**
 * What the entry routes do (DESIGN.md §6.2, §14.4), apart from the route files so that a test calls them as a second person. The account and the book are the
 * session's and nothing in a request names whose; **an entry of another person is a 404 with nothing in it**, as one that never was.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });
const idOf = (params: BookContext['params']) => (typeof params.id === 'string' ? params.id : '');

async function body(request: Request): Promise<{ value: unknown } | Response> {
  const raw = await readCapped(request, 64 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return json({ problems: ['The request is not JSON.'] }, 400);
  }
}

/** What the add dialog offers: the accounts, the subcategories and the income sources the person can use, and today on the book's own clock. */
export async function options(database: Database, { accountId }: BookContext) {
  const book = await findBook(database, accountId);
  if (!book) return notFound();
  return json(await loadEntryOptions(database, accountId, book, todayIn(book.timeZone)));
}

export async function create(database: Database, { request, accountId, bookId }: BookContext) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const parsed = parseTxnInput(read.value);
  if (!parsed.ok) return json({ problems: parsed.problems }, 400);
  const result = await createTransaction(database, accountId, bookId, parsed.value);
  if (result.ok) return json({ id: result.id }, 201);
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
}

export async function read(database: Database, { accountId, bookId, params }: BookContext) {
  const entry = await getEntry(database, accountId, bookId, idOf(params));
  return entry ? json({ entry }) : notFound();
}

export async function change(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const parsed = parseTxnInput(read.value);
  if (!parsed.ok) return json({ problems: parsed.problems }, 400);
  const result = await updateTransaction(database, accountId, bookId, idOf(params), parsed.value);
  if (result.ok) return json({ id: result.id });
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
}

export async function remove(database: Database, { accountId, bookId, params }: BookContext) {
  return (await deleteTransaction(database, accountId, bookId, idOf(params)))
    ? json({ deleted: true })
    : notFound();
}

/**
 * Something done to several entries at once (DESIGN.md §6.9): `{ action: 'status', ids, status }`, `{ action: 'recategorise', ids, subcategoryId }` or
 * `{ action: 'delete', ids }`. The answer says how many were changed and how many skipped; an id that is not the account's is skipped, as one that is not there.
 */
export async function bulk(database: Database, { request, accountId, bookId }: BookContext) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const value = read.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return json({ problems: ['The request is not an action.'] }, 400);
  const { action, ids, status, subcategoryId } = value as Record<string, unknown>;
  if (!Array.isArray(ids)) return json({ problems: ['The entries are a list.'] }, 400);
  const result =
    action === 'status' && (status === 'pending' || status === 'cleared')
      ? await bulkSetStatus(database, accountId, bookId, ids, status)
      : action === 'recategorise' && typeof subcategoryId === 'string'
        ? await bulkRecategorise(database, accountId, bookId, ids, subcategoryId)
        : action === 'delete'
          ? await bulkDelete(database, accountId, bookId, ids)
          : undefined;
  if (!result)
    return json({ problems: ['That is not something that can be done to 1 to 200 entries.'] }, 400);
  return json(result);
}
