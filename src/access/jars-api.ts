import { monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { balancesOf } from '../ledger/balances';
import { findBook } from '../ledger/books';
import {
  accountFigures,
  createJar,
  earmarkedByAccount,
  listJars,
  moveJar,
  moveMoney,
  setJarArchived,
  updateJar,
} from '../jars/jars';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the jar routes do (DESIGN.md §10), apart from the route files so that a test calls them as a second person. The account and the book are the session's
 * and nothing in a request names whose; **a jar of another person is a 404 with nothing in it**, as one that never was. What a request says is read here and
 * checked again, as sentences, where it is written (`src/jars/jars.ts`).
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });
const bad = (problem: string) => json({ problems: [problem] }, 400);
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

const answer = (
  result:
    | { ok: true; id: string }
    | { ok: false; reason: 'not_found' }
    | { ok: false; reason: 'invalid'; problems: readonly string[] },
  status = 200,
) => {
  if (result.ok) return json({ id: result.id }, status);
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
};

/** The jars with their balances, and for each account that has them what it holds, what is in jars and what is free. */
export async function list(database: Database, { accountId, bookId }: BookContext) {
  const [jars, earmarked, balances] = await Promise.all([
    listJars(database, accountId, bookId),
    earmarkedByAccount(database, accountId, bookId),
    balancesOf(database, accountId, bookId),
  ]);
  const accounts = [...new Set(jars.map((jar) => jar.accountId))].map((id) => ({
    id,
    ...accountFigures(balances.get(id) ?? 0, earmarked.get(id) ?? 0),
  }));
  return json({ jars, accounts });
}

/** Makes a jar: `{ accountId, name, target?, monthly? }`. */
export async function create(database: Database, { request, accountId, bookId }: BookContext) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { accountId: inAccount, name, target, monthly } = read.value;
  if (
    typeof inAccount !== 'string' ||
    typeof name !== 'string' ||
    (target != null && typeof target !== 'number') ||
    (monthly != null && typeof monthly !== 'number')
  )
    return bad('A jar has an account, a name, and perhaps a target and a monthly contribution.');
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return notFound();
  return answer(
    await createJar(
      database,
      accountId,
      bookId,
      {
        accountId: inAccount,
        name,
        target: (target as number | null | undefined) ?? null,
        monthly: (monthly as number | null | undefined) ?? null,
      },
      monthOf(todayIn(book.timeZone)),
    ),
    201,
  );
}

/** Renames a jar, changes its target, archives it or brings it back, or moves it to another account: `{ name?, target?, archived?, accountId? }`. */
export async function change(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { name, target, archived, accountId: toAccount } = read.value;
  if (
    (name !== undefined && typeof name !== 'string') ||
    (target !== undefined && target !== null && typeof target !== 'number') ||
    (archived !== undefined && typeof archived !== 'boolean') ||
    (toAccount !== undefined && typeof toAccount !== 'string')
  )
    return bad('That is not a change to a jar.');
  if (
    name === undefined &&
    target === undefined &&
    archived === undefined &&
    toAccount === undefined
  )
    return bad('There is nothing to change.');
  const id = idOf(params);
  if (name !== undefined || target !== undefined) {
    const result = await updateJar(database, accountId, bookId, id, {
      ...(name === undefined ? {} : { name: name as string }),
      ...(target === undefined ? {} : { target: target as number | null }),
    });
    if (!result.ok) return answer(result);
  }
  if (typeof toAccount === 'string') {
    const book = await findBook(database, accountId);
    if (!book || book.id !== bookId) return notFound();
    const result = await moveJar(
      database,
      accountId,
      bookId,
      id,
      toAccount,
      todayIn(book.timeZone),
    );
    if (!result.ok) return answer(result);
  }
  if (typeof archived === 'boolean') {
    const result = await setJarArchived(database, accountId, bookId, id, archived);
    if (!result.ok) return answer(result);
  }
  return json({ id });
}

/** Earmarks money in a jar or releases some: `{ direction: 'earmark' | 'release', amount, date? }`; the day is today by the book's clock when none is given. */
export async function movement(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { direction, amount, date } = read.value;
  if (
    (direction !== 'earmark' && direction !== 'release') ||
    typeof amount !== 'number' ||
    (date !== undefined && typeof date !== 'string')
  )
    return bad('Money is earmarked or released, in a whole amount.');
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return notFound();
  return answer(
    await moveMoney(database, accountId, bookId, idOf(params), {
      direction,
      amount,
      date: (date as string | undefined) ?? todayIn(book.timeZone),
    }),
    201,
  );
}
