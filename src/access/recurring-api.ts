import type { Database } from '../db/client';
import { findBook } from '../ledger/books';
import {
  type Mode,
  type NewRecurring,
  type RecurringPatch,
  type Template,
  createRecurring,
  endRecurring,
  listRecurring,
  listUpcoming,
  postOccurrence,
  repeatEntry,
  skipOccurrence,
  updateRecurring,
} from '../recurring/recurring';
import { withAmount } from '../recurring/present';
import { UNITS } from '../recurring/rule';
import { readCapped } from './body';
import type { BookContext } from './route';
import { lineOf } from './txn-input';

/**
 * What the recurring routes do (DESIGN.md §8), apart from the route files so that a test calls them as a second person. The account and the book are the
 * session's and nothing in a request names whose; **a recurring entry of another person is a 404 with nothing in it**, as one that never was. What a request
 * says is read here and checked again, as sentences, where it is written (`src/recurring/recurring.ts`).
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });
const idOf = (params: BookContext['params']) => (typeof params.id === 'string' ? params.id : '');
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function body(request: Request): Promise<{ value: Record<string, unknown> } | Response> {
  const raw = await readCapped(request, 64 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return json({ problems: ['The request is not an object.'] }, 400);
    return { value };
  } catch {
    return json({ problems: ['The request is not JSON.'] }, 400);
  }
}

const bad = (problem: string) => json({ problems: [problem] }, 400);

/** A template from JSON: rebuilt from the fields it may have, the unknown ones never copied. */
function templateOf(value: unknown): Template | undefined {
  if (!isObject(value)) return undefined;
  const { type, lines, payee, note } = value;
  if ((type !== 'expense' && type !== 'income' && type !== 'transfer') || !Array.isArray(lines))
    return undefined;
  if (lines.length > 100) return undefined;
  if ((payee != null && typeof payee !== 'string') || (note != null && typeof note !== 'string'))
    return undefined;
  const read = lines.map(lineOf);
  if (read.some((line) => line === undefined)) return undefined;
  return {
    type,
    lines: read as Template['lines'],
    payee: (payee as string | null | undefined) ?? null,
    note: (note as string | null | undefined) ?? null,
  };
}

const unitOf = (value: unknown): NewRecurring['unit'] | undefined =>
  (UNITS as readonly unknown[]).includes(value) ? (value as NewRecurring['unit']) : undefined;
const modeOf = (value: unknown): Mode | undefined =>
  value === 'auto' || value === 'confirm' ? value : undefined;

const answer = (
  result:
    | { ok: true; id: string }
    | { ok: false; reason: 'not_found' }
    | { ok: false; reason: 'invalid'; problems: readonly string[] },
  status: number,
) => {
  if (result.ok) return json({ id: result.id }, status);
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
};

export async function list(database: Database, { accountId, bookId }: BookContext) {
  return json({ recurring: await listRecurring(database, accountId, bookId) });
}

/**
 * Makes a recurring entry: `{ template, unit, every, anchor, end?, mode }` from scratch, or `{ entryId, unit, every, end?, mode }` to make an entry that was
 * written repeat ("Repeat…").
 */
export async function create(database: Database, { request, accountId, bookId }: BookContext) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { entryId, template, unit, every, anchor, end, mode } = read.value;
  const parsedUnit = unitOf(unit);
  const parsedMode = modeOf(mode);
  if (!parsedUnit || typeof every !== 'number' || !parsedMode)
    return bad('A repeat has a unit, a number of them and a mode.');
  if (end != null && typeof end !== 'string') return bad('The end is a day.');
  if (typeof entryId === 'string')
    return answer(
      await repeatEntry(database, accountId, bookId, entryId, {
        unit: parsedUnit,
        every,
        end: (end as string | null | undefined) ?? null,
        mode: parsedMode,
      }),
      201,
    );
  const parsedTemplate = templateOf(template);
  if (!parsedTemplate) return bad('The entry to repeat is not an entry.');
  if (typeof anchor !== 'string') return bad('The first day is a day.');
  return answer(
    await createRecurring(database, accountId, bookId, {
      template: parsedTemplate,
      unit: parsedUnit,
      every,
      anchor,
      end: (end as string | null | undefined) ?? null,
      mode: parsedMode,
    }),
    201,
  );
}

/** Changes what is to come: `{ mode?, end?, unit?, every?, template? }`, or ends the entry with `{ ended: true }`. */
export async function change(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { mode, end, unit, every, template, ended } = read.value;
  const id = idOf(params);
  if (ended !== undefined && ended !== true) return bad('That is not a change to a repeat.');
  const patch: { -readonly [K in keyof RecurringPatch]: RecurringPatch[K] } = {};
  if (mode !== undefined) {
    const parsed = modeOf(mode);
    if (!parsed) return bad('A repeat posts itself or waits to be confirmed.');
    patch.mode = parsed;
  }
  if (end !== undefined) {
    if (end !== null && typeof end !== 'string') return bad('The end is a day or nothing.');
    patch.end = end;
  }
  if (unit !== undefined) {
    const parsed = unitOf(unit);
    if (!parsed) return bad('A repeat is by the day, the week, the month or the year.');
    patch.unit = parsed;
  }
  if (every !== undefined) {
    if (typeof every !== 'number') return bad('How often is a number.');
    patch.every = every;
  }
  if (template !== undefined) {
    const parsed = templateOf(template);
    if (!parsed) return bad('The entry to repeat is not an entry.');
    patch.template = parsed;
  }
  if (ended === undefined && Object.keys(patch).length === 0)
    return bad('There is nothing to change.');
  if (Object.keys(patch).length > 0) {
    const result = await updateRecurring(database, accountId, bookId, id, patch);
    if (!result.ok) return answer(result, 200);
  }
  if (ended === true && !(await endRecurring(database, accountId, bookId, id))) return notFound();
  return json({ id });
}

/** Ends a recurring entry: nothing more is posted; what was posted stays. */
export async function remove(database: Database, { accountId, bookId, params }: BookContext) {
  return (await endRecurring(database, accountId, bookId, idOf(params)))
    ? json({ ended: true })
    : notFound();
}

/** What waits to be confirmed: the next occurrence of each entry that asks first, overdue ones included. */
export async function upcoming(database: Database, { accountId, bookId }: BookContext) {
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return notFound();
  return json({ upcoming: await listUpcoming(database, accountId, bookId, book.timeZone) });
}

const STALE = 'That was handled already. The list is up to date now.';

/**
 * Posts an occurrence that waits to be confirmed, as it is or with a corrected amount: `{ date, amount? }`, where `date` is the occurrence the person was
 * shown. It is posted by the person, through the one write path, and the entry moves on to the next.
 */
export async function post(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { date, amount } = read.value;
  if (typeof date !== 'string') return bad('The day of the occurrence is a day.');
  if (amount !== undefined && typeof amount !== 'number')
    return bad('The amount is a whole number of the smallest unit.');
  const id = idOf(params);
  let template: Template | undefined;
  if (amount !== undefined) {
    const found = (await listRecurring(database, accountId, bookId)).find((row) => row.id === id);
    if (!found) return notFound();
    template = withAmount(found.template, amount);
    if (!template)
      return bad('That amount is not a change this entry can take. Post it as it is and edit it.');
  }
  const outcome = await postOccurrence(database, accountId, bookId, id, date, Date.now(), {
    expect: date,
    ...(template ? { template } : {}),
  });
  switch (outcome.status) {
    case 'posted':
    case 'passed':
      return json({ posted: outcome.status === 'posted', date });
    case 'failed':
      return json({ problems: outcome.problems }, 400);
    case 'stale':
    case 'lost':
      return json({ problems: [STALE] }, 409);
    default:
      return notFound();
  }
}

/** Skips an occurrence that waits to be confirmed: `{ date }`. The entry moves on to the next. */
export async function skip(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  if (typeof read.value.date !== 'string') return bad('The day of the occurrence is a day.');
  const result = await skipOccurrence(database, accountId, bookId, idOf(params), read.value.date);
  if (result === 'skipped') return json({ skipped: true });
  return result === 'stale' ? json({ problems: [STALE] }, 409) : notFound();
}
