import { isCalendarDay } from '../dates';
import type { Database } from '../db/client';
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  setArchived,
  updateAccount,
} from '../ledger/accounts';
import { reconcile, reconcileSummary } from '../ledger/reconcile';
import { revalue } from '../ledger/revalue';
import { parseAccountPatch, parseNewAccount } from './account-input';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the account routes do (DESIGN.md §6.1), apart from the route files so that a test calls them as a second person with its own database: the route
 * files are one line each, `export const GET = bookRoute(async (c) => list(await getDatabase(), c))`. The account and the book are the session's, and
 * **nothing in a request names whose**; another person's account is a 404 with nothing in it, the answer for one that never was.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });
const idOf = (params: BookContext['params']) => (typeof params.id === 'string' ? params.id : '');

/** A JSON body of at most 16 KiB, or the response that refuses it. */
async function body(request: Request): Promise<{ value: unknown } | Response> {
  const raw = await readCapped(request, 16 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return json({ problems: ['The request is not JSON.'] }, 400);
  }
}

export async function list(database: Database, { request, accountId, bookId }: BookContext) {
  const archived = new URL(request.url).searchParams.get('archived') === '1';
  return json({ accounts: await listAccounts(database, accountId, bookId, { archived }) });
}

export async function create(database: Database, { request, accountId, bookId }: BookContext) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const parsed = parseNewAccount(read.value);
  if (!parsed.ok) return json({ problems: parsed.problems }, 400);
  const result = await createAccount(database, accountId, bookId, parsed.value);
  if (result.ok) return json({ id: result.id }, 201);
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
}

export async function read(database: Database, { accountId, bookId, params }: BookContext) {
  const account = await getAccount(database, accountId, bookId, idOf(params));
  return account ? json({ account }) : notFound();
}

export async function change(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const parsed = parseAccountPatch(read.value);
  if (!parsed.ok) return json({ problems: parsed.problems }, 400);
  const id = idOf(params);
  const { patch, archived } = parsed.value;
  if (Object.keys(patch).length > 0) {
    const result = await updateAccount(database, accountId, bookId, id, patch);
    if (!result.ok)
      return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
  }
  if (archived !== undefined && !(await setArchived(database, accountId, bookId, id, archived)))
    return notFound();
  return json({ id });
}

export async function remove(database: Database, { accountId, bookId, params }: BookContext) {
  const result = await deleteAccount(database, accountId, bookId, idOf(params));
  if (result === 'not_found') return notFound();
  if (result === 'has_entries')
    return json(
      { problems: ['This account has entries. Archive it instead: it stays in past totals.'] },
      409,
    );
  return json({ deleted: true });
}

/** What reconciling to a day would be compared with: `?date=YYYY-MM-DD`. Another person's account is a 404 with nothing in it. */
export async function reconcileInfo(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const date = new URL(request.url).searchParams.get('date') ?? '';
  if (!isCalendarDay(date))
    return json({ problems: ['The statement needs the day it is of.'] }, 400);
  const summary = await reconcileSummary(database, accountId, bookId, idOf(params), date);
  return summary ? json({ summary }) : notFound();
}

/** Reconciles the account to its statement: `{ date, balance }`, the balance signed like a balance. The answer says what was recorded and how many were cleared. */
export async function reconcileNow(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const value = read.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return json({ problems: ['The request is not a statement.'] }, 400);
  const { date, balance } = value as Record<string, unknown>;
  if (typeof date !== 'string' || typeof balance !== 'number')
    return json({ problems: ['The statement needs a day and a balance.'] }, 400);
  const result = await reconcile(database, accountId, bookId, idOf(params), { date, balance });
  if (result.ok) return json({ adjustment: result.adjustment, cleared: result.cleared });
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
}

/** Gives an investment or a property a value: `{ date, value }`, the value in minor units. The answer says the change recorded, 0 when it was worth that already. */
export async function valueNow(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const value = read.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return json({ problems: ['The request is not a value.'] }, 400);
  const { date, value: amount } = value as Record<string, unknown>;
  if (typeof date !== 'string' || typeof amount !== 'number')
    return json({ problems: ['A value needs a day and an amount.'] }, 400);
  const result = await revalue(database, accountId, bookId, idOf(params), { date, value: amount });
  if (result.ok) return json({ change: result.change });
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
}
