import {
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  listCategories,
  renameCategory,
  renameSubcategory,
  reorderCategories,
  reorderSubcategories,
  setCategoryArchived,
  type DeleteCategory,
} from '../budget/categories';
import type { Database } from '../db/client';
import type { WriteResult } from '../ledger/transactions';
import { readCapped } from './body';
import type { BookContext } from './route';

/**
 * What the category routes do (DESIGN.md §7.1), apart from the route files so that a test calls them as a second person. The account and the book are the
 * session's and **nothing in a request names whose**; a category or subcategory of another person is a 404 with nothing in it, as one that never was.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(null, { status: 404 });
const idOf = (params: BookContext['params']) => (typeof params.id === 'string' ? params.id : '');

type Body = Record<string, unknown>;

/** A JSON object of at most 16 KiB, or the response that refuses it. */
async function body(request: Request): Promise<{ value: Body } | Response> {
  const raw = await readCapped(request, 16 * 1024);
  if (raw === null) return json({ problems: ['That is too much to send.'] }, 413);
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return json({ problems: ['The request is not an object.'] }, 400);
    return { value: value as Body };
  } catch {
    return json({ problems: ['The request is not JSON.'] }, 400);
  }
}

const answer = (result: WriteResult, created = false): Response =>
  result.ok
    ? json({ id: result.id }, created ? 201 : 200)
    : result.reason === 'invalid'
      ? json({ problems: result.problems }, 400)
      : notFound();

const deleted = (result: DeleteCategory): Response =>
  result === 'deleted'
    ? json({ deleted: true })
    : result === 'not_found'
      ? notFound()
      : json(
          { problems: ['This has been spent on. Archive it instead: it stays in past months.'] },
          409,
        );

const ids = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((each) => typeof each === 'string')
    ? (value as string[])
    : undefined;

export async function list(database: Database, { accountId, bookId }: BookContext) {
  return json({ categories: await listCategories(database, accountId, bookId) });
}

export async function create(database: Database, { request, accountId, bookId }: BookContext) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { name, currency } = read.value;
  if (typeof name !== 'string' || (currency != null && typeof currency !== 'string'))
    return json({ problems: ['The name and the currency are text.'] }, 400);
  return answer(
    await createCategory(database, accountId, bookId, { name, currency: currency ?? null }),
    true,
  );
}

/** Puts the categories in the order the body gives: `{ order: [id, …] }`. */
export async function reorder(database: Database, { request, accountId, bookId }: BookContext) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const order = ids(read.value.order);
  if (!order) return json({ problems: ['The order is a list of categories.'] }, 400);
  return (await reorderCategories(database, accountId, bookId, order))
    ? json({ ok: true })
    : notFound();
}

/** Renames a category, archives it or brings it back, or orders its subcategories: `{ name?, archived?, order? }`. */
export async function changeCategory(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { name, archived, order } = read.value;
  if (
    (name !== undefined && typeof name !== 'string') ||
    (archived !== undefined && typeof archived !== 'boolean') ||
    (order !== undefined && !ids(order))
  )
    return json({ problems: ['That is not a change to a category.'] }, 400);
  if (name === undefined && archived === undefined && order === undefined)
    return json({ problems: ['There is nothing to change.'] }, 400);
  const id = idOf(params);
  if (typeof name === 'string') {
    const result = await renameCategory(database, accountId, bookId, id, name);
    if (!result.ok) return answer(result);
  }
  if (
    order !== undefined &&
    !(await reorderSubcategories(database, accountId, bookId, id, order as string[]))
  )
    return notFound();
  if (
    typeof archived === 'boolean' &&
    !(await setCategoryArchived(database, accountId, bookId, 'category', id, archived))
  )
    return notFound();
  return json({ id });
}

export async function removeCategory(
  database: Database,
  { accountId, bookId, params }: BookContext,
) {
  return deleted(await deleteCategory(database, accountId, bookId, idOf(params)));
}

export async function addSubcategory(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  if (typeof read.value.name !== 'string') return json({ problems: ['The name is text.'] }, 400);
  return answer(
    await createSubcategory(database, accountId, bookId, idOf(params), { name: read.value.name }),
    true,
  );
}

/** Renames a subcategory, archives it or brings it back: `{ name?, archived? }`. */
export async function changeSubcategory(
  database: Database,
  { request, accountId, bookId, params }: BookContext,
) {
  const read = await body(request);
  if (read instanceof Response) return read;
  const { name, archived } = read.value;
  if (
    (name !== undefined && typeof name !== 'string') ||
    (archived !== undefined && typeof archived !== 'boolean')
  )
    return json({ problems: ['That is not a change to a subcategory.'] }, 400);
  if (name === undefined && archived === undefined)
    return json({ problems: ['There is nothing to change.'] }, 400);
  const id = idOf(params);
  if (typeof name === 'string') {
    const result = await renameSubcategory(database, accountId, bookId, id, name);
    if (!result.ok) return answer(result);
  }
  if (
    typeof archived === 'boolean' &&
    !(await setCategoryArchived(database, accountId, bookId, 'subcategory', id, archived))
  )
    return notFound();
  return json({ id });
}

export async function removeSubcategory(
  database: Database,
  { accountId, bookId, params }: BookContext,
) {
  return deleted(await deleteSubcategory(database, accountId, bookId, idOf(params)));
}
