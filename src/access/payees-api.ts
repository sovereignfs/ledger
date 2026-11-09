import type { Database } from '../db/client';
import {
  getPayee,
  listPayees,
  mergePayees,
  payeeMonths,
  renamePayee,
  setPayeeArchived,
} from '../ledger/payees';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the payee routes do (DESIGN.md §6.5), apart from the route files so that a test calls them as a second person. The account and the book are the
 * session's and nothing in a request names whose; **a payee of another person is a 404 with nothing in it**, as one that never was.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });
const idOf = (params: BookContext['params']) => (typeof params.id === 'string' ? params.id : '');

/** The payees, by name: `?q=` finds those with that in their name (the autocomplete asks as a person types), `?archived=1` the archived ones. */
export async function list(database: Database, { request, accountId, bookId }: BookContext) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? undefined;
  const archived = url.searchParams.get('archived') === '1';
  return json({
    payees: await listPayees(database, accountId, bookId, {
      archived,
      ...(query === undefined || query.length > 200 ? {} : { query }),
      limit: 50,
    }),
  });
}

export async function read(database: Database, { accountId, bookId, params }: BookContext) {
  const id = idOf(params);
  const payee = await getPayee(database, accountId, bookId, id);
  if (!payee) return notFound();
  return json({ payee, months: await payeeMonths(database, accountId, bookId, id) });
}

/** Renames a payee, archives it or brings it back, or merges it into another: `{ name? , archived?, mergeInto? }`. A merge stands alone. */
export async function change(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const raw = await readCapped(request, 16 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ problems: ['The request is not JSON.'] }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return json({ problems: ['The request is not a change.'] }, 400);
  const { name, archived, mergeInto } = body as Record<string, unknown>;
  if (
    (name !== undefined && typeof name !== 'string') ||
    (archived !== undefined && typeof archived !== 'boolean') ||
    (mergeInto !== undefined && typeof mergeInto !== 'string')
  )
    return json({ problems: ['That is not a change to a payee.'] }, 400);
  if (name === undefined && archived === undefined && mergeInto === undefined)
    return json({ problems: ['There is nothing to change.'] }, 400);
  const id = idOf(params);
  if (typeof mergeInto === 'string') {
    if (name !== undefined || archived !== undefined)
      return json({ problems: ['A merge is not combined with another change.'] }, 400);
    return (await mergePayees(database, accountId, bookId, id, mergeInto))
      ? json({ id: mergeInto })
      : notFound();
  }
  if (typeof name === 'string') {
    const result = await renamePayee(database, accountId, bookId, id, name);
    if (!result.ok)
      return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
  }
  if (
    typeof archived === 'boolean' &&
    !(await setPayeeArchived(database, accountId, bookId, id, archived))
  )
    return notFound();
  return json({ id });
}
