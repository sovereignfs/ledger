import { budgetHistory, budgetsForMonth, isTargetKind, setBudget } from '../budget/amounts';
import { isMonth, monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { findBook } from '../ledger/books';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the budget route does (DESIGN.md §7.3), apart from the route file so that a test calls it as a second person. The account and the book are the
 * session's; **the month a change is "from this month" is the book's own, worked out here from its clock and never taken from the request**, so a request
 * cannot write a past month. A target of another person's is a 404 with nothing in it.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });

/**
 * `?month=YYYY-MM`: every target's budgeted amount in force for that month, keyed `<kind>:<id>`. `?kind=&id=`: one target's history, oldest first, with the
 * amount in force now.
 */
export async function read(database: Database, { request, accountId, bookId }: BookContext) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month');
  if (month !== null) {
    if (!isMonth(month)) return json({ problems: ['A month is written like 2026-11.'] }, 400);
    return json({
      month,
      amounts: Object.fromEntries(await budgetsForMonth(database, accountId, bookId, month)),
    });
  }
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id') ?? '';
  if (!isTargetKind(kind) || id === '')
    return json({ problems: ['Ask for a month, or for a subcategory or an income source.'] }, 400);
  return json({ history: await budgetHistory(database, accountId, bookId, kind, id) });
}

/** Sets a budgeted amount from this month or from next: `{ kind, id, amount, when }`. An amount of nothing ends the budget. */
export async function write(database: Database, { request, accountId, bookId }: BookContext) {
  const raw = await readCapped(request, 16 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ problems: ['The request is not JSON.'] }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return json({ problems: ['The request is not a budget.'] }, 400);
  const { kind, id, amount, when } = body as Record<string, unknown>;
  if (
    !isTargetKind(kind) ||
    typeof id !== 'string' ||
    typeof amount !== 'number' ||
    (when !== 'this' && when !== 'next')
  )
    return json(
      {
        problems: [
          'A budget needs what it is for, an amount, and whether it is from this month or next.',
        ],
      },
      400,
    );
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) return notFound();
  const result = await setBudget(database, accountId, bookId, {
    kind,
    targetId: id,
    amount,
    when,
    currentMonth: monthOf(todayIn(book.timeZone)),
  });
  if (result.ok) return json({ id: result.id });
  return result.reason === 'invalid' ? json({ problems: result.problems }, 400) : notFound();
}
