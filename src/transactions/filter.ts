import { isCalendarDay } from '../dates';
import { TXN_STATUSES, TXN_TYPES, type TxnStatus, type TxnType } from '../ledger/validate';

/**
 * The filters of the transactions list (DESIGN.md §6.9), **kept in the address** so that a view can be bookmarked, shared with oneself and reopened: the
 * same address is the same view. `parseFilter` reads what an address says and **ignores whatever is not a filter or not a valid one**, never failing a page;
 * `filterQuery` writes a filter back. They are pure and each is the other's inverse for a filter that is valid. Text is matched as text, never as a pattern.
 *
 *   /transactions?account=…&category=…&type=expense&status=pending&from=2026-10-01&to=2026-10-31&q=lunch&before=…
 */
export interface EntryFilter {
  /** A money account: the entries that have a line on it. */
  readonly account?: string;
  /** A category, or one of its subcategories: the entries that have a line on it. A subcategory is narrower, and wins. */
  readonly category?: string;
  readonly subcategory?: string;
  readonly payee?: string;
  readonly type?: TxnType;
  readonly status?: TxnStatus;
  /** Inclusive days, `YYYY-MM-DD`. */
  readonly from?: string;
  readonly to?: string;
  /** Part of a payee's name or a note, in any case. */
  readonly q?: string;
}

/** Where the next page of older entries starts: the last entry shown, by date, when it was made and its id. Opaque to a person; part of the address. */
export interface Cursor {
  readonly date: string;
  readonly createdAt: number;
  readonly id: string;
}

export const MAX_TEXT = 100;
const MAX_ID = 64;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

const read = (params: Params, name: string): string | undefined => {
  const value = params instanceof URLSearchParams ? (params.get(name) ?? undefined) : params[name];
  const text = Array.isArray(value) ? value[0] : value;
  return text === undefined || text === '' ? undefined : text;
};

const id = (value: string | undefined): string | undefined =>
  value !== undefined && value.length <= MAX_ID && /^[0-9A-Za-z_-]+$/.test(value)
    ? value
    : undefined;

const day = (value: string | undefined): string | undefined =>
  value !== undefined && isCalendarDay(value) ? value : undefined;

/** The filter an address says. Anything that is not a valid value is left out. A range that ends before it begins is swapped, as a person would mean it. */
export function parseFilter(params: Params): EntryFilter {
  const type = read(params, 'type');
  const status = read(params, 'status');
  const q = read(params, 'q')?.trim();
  let from = day(read(params, 'from'));
  let to = day(read(params, 'to'));
  if (from !== undefined && to !== undefined && from > to) [from, to] = [to, from];
  const filter: { -readonly [K in keyof EntryFilter]: EntryFilter[K] } = {};
  const account = id(read(params, 'account'));
  const category = id(read(params, 'category'));
  const subcategory = id(read(params, 'subcategory'));
  const payee = id(read(params, 'payee'));
  if (account) filter.account = account;
  if (category) filter.category = category;
  if (subcategory) filter.subcategory = subcategory;
  if (payee) filter.payee = payee;
  if (type !== undefined && (TXN_TYPES as readonly string[]).includes(type))
    filter.type = type as TxnType;
  if (status !== undefined && (TXN_STATUSES as readonly string[]).includes(status))
    filter.status = status as TxnStatus;
  if (from) filter.from = from;
  if (to) filter.to = to;
  if (q) filter.q = q.slice(0, MAX_TEXT);
  return filter;
}

/** The query string of a filter (and a cursor), in a fixed order, so that one view has one address. Empty for no filter. */
export function filterQuery(filter: EntryFilter, cursor?: Cursor): string {
  const out = new URLSearchParams();
  for (const name of [
    'account',
    'category',
    'subcategory',
    'payee',
    'type',
    'status',
    'from',
    'to',
    'q',
  ] as const) {
    const value = filter[name];
    if (value !== undefined && value !== '') out.set(name, value);
  }
  if (cursor) out.set('before', encodeCursor(cursor));
  return out.toString();
}

/** How many filters are on, for a heading that says so. */
export const filterCount = (filter: EntryFilter): number => Object.keys(filter).length;

export function encodeCursor(cursor: Cursor): string {
  return `${cursor.date}~${cursor.createdAt}~${cursor.id}`;
}

/** The cursor an address names, or `undefined` for anything that is not one. */
export function parseCursor(text: string | undefined): Cursor | undefined {
  if (text === undefined) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})~(\d{1,16})~([0-9A-Za-z_-]{1,64})$/.exec(text);
  if (!match || !isCalendarDay(match[1] as string)) return undefined;
  return { date: match[1] as string, createdAt: Number(match[2]), id: match[3] as string };
}
