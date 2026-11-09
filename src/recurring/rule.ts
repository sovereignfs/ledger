import { isCalendarDay } from '../dates';
import { divideRoundHalfEven } from '../money/amount';

/**
 * The repeat rule (DESIGN.md §8.1, §8.4), **pure**: no clock, no zone, no database. Every N days, weeks, months or years from an anchor date, optionally until
 * an end date; the date a rule gives next, the dates between two days, and what a rule comes to in a month. A date is `YYYY-MM-DD` with no zone.
 *
 * **Not copied from Tusk's `recurrence.ts`**, though it is that file's idea and keeps its names where they fit: Tusk's rule is an RFC 5545 `RRULE` run by
 * the `rrule` package, which skips a month that lacks the day (a monthly rule on the 31st never lands in February), and Ledger's design is the other way: **the
 * 31st falls on the last day of a shorter month**, so rent due on the 31st is due every month. That is a small rule to write from calendar arithmetic, so there
 * is no dependency, and the rule is what `DESIGN.md` §18.3 stores (`unit`, `every`, `anchor_date`, `end_date`).
 *
 * Every occurrence is **counted from the anchor and not from the one before**, so 31 January monthly is 28 February and then 31 March, not 28 March; and a date
 * crosses into the arithmetic only through `Date.UTC` and comes back only through `getUTC*`, so no zone and no daylight-saving change moves a day (the tests
 * run under three zones).
 */
export const UNITS = ['day', 'week', 'month', 'year'] as const;
export type Unit = (typeof UNITS)[number];

export interface Rule {
  readonly unit: Unit;
  /** 1 to 999: every this many days, weeks, months or years. */
  readonly every: number;
  /** The first occurrence, which the day of the month of a monthly or yearly rule is taken from. */
  readonly anchor: string;
  /** The last day an occurrence may fall on, inclusive; `null` for never. */
  readonly end: string | null;
}

export const MAX_EVERY = 999;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function parts(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

const fromUtc = (at: Date): string =>
  `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;

const daysIn = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The sentences that say what is wrong with a rule; empty for one that may be used. */
export function checkRule(rule: Rule): string[] {
  const problems: string[] = [];
  if (!(UNITS as readonly string[]).includes(rule.unit))
    problems.push('A repeat is every so many days, weeks, months or years.');
  if (!Number.isInteger(rule.every) || rule.every < 1 || rule.every > MAX_EVERY)
    problems.push(`A repeat is every 1 to ${MAX_EVERY} of them.`);
  if (typeof rule.anchor !== 'string' || !isCalendarDay(rule.anchor))
    problems.push('A repeat needs the day it starts.');
  else if (
    rule.end !== null &&
    (typeof rule.end !== 'string' || !isCalendarDay(rule.end) || rule.end < rule.anchor)
  )
    problems.push('A repeat does not end before it starts.');
  return problems;
}

/** The largest index whose date is not past the year 9999, so that a search always ends and no date is one the calendar cannot write. */
function maxIndex(rule: Rule): number {
  const [year, month, day] = parts(rule.anchor);
  switch (rule.unit) {
    case 'day':
    case 'week': {
      const days = Math.floor(
        (Date.UTC(9999, 11, 31) - Date.UTC(year, month - 1, day)) / 86_400_000,
      );
      return Math.floor(days / (rule.unit === 'week' ? 7 * rule.every : rule.every));
    }
    case 'month':
      return Math.floor(((9999 - year) * 12 + (12 - month)) / rule.every);
    case 'year':
      return Math.floor((9999 - year) / rule.every);
  }
}

/** The date of occurrence `index` (0 is the anchor), ignoring the end. */
function dateOf(rule: Rule, index: number): string {
  const [year, month, day] = parts(rule.anchor);
  const step = index * rule.every;
  switch (rule.unit) {
    case 'day':
      return fromUtc(new Date(Date.UTC(year, month - 1, day + step)));
    case 'week':
      return fromUtc(new Date(Date.UTC(year, month - 1, day + 7 * step)));
    case 'month': {
      const at = year * 12 + (month - 1) + step;
      const y = Math.floor(at / 12);
      const m = (at % 12) + 1;
      return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(day, daysIn(y, m)))}`;
    }
    case 'year': {
      const y = year + step;
      return `${pad(y, 4)}-${pad(month)}-${pad(Math.min(day, daysIn(y, month)))}`;
    }
  }
}

/** The `index`th occurrence (0 is the anchor), or `null` when it is past the end of the rule. */
export function occurrence(rule: Rule, index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > maxIndex(rule)) return null;
  const date = dateOf(rule, index);
  return rule.end !== null && date > rule.end ? null : date;
}

/** The smallest index whose date is after `after` (strictly), by a search over a sequence that only grows; `null` when the rule has ended before then. */
function firstAfterIndex(rule: Rule, after: string): number | null {
  if (dateOf(rule, 0) > after) return 0;
  if (dateOf(rule, maxIndex(rule)) <= after) return null;
  let low = 0; // dateOf(low) <= after
  let high = maxIndex(rule);
  if (dateOf(rule, high) <= after) return null;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dateOf(rule, middle) <= after) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * The first occurrence **after** a day (strictly), or `null` when the rule has ended or the days are not days. Given the day an entry was last posted for, it is
 * the day it is next due.
 */
export function nextOccurrence(rule: Rule, after: string): string | null {
  if (checkRule(rule).length > 0 || !isCalendarDay(after)) return null;
  const index = firstAfterIndex(rule, after);
  return index === null ? null : occurrence(rule, index);
}

/** The first occurrence **on or after** a day: the day itself if the rule falls on it. `null` when the rule has ended. */
export function firstOnOrAfter(rule: Rule, day: string): string | null {
  if (checkRule(rule).length > 0 || !isCalendarDay(day)) return null;
  if (occurrenceIs(rule, day)) return day;
  return nextOccurrence(rule, day);
}

/** Whether the rule falls on a day. */
export function occurrenceIs(rule: Rule, day: string): boolean {
  if (checkRule(rule).length > 0 || !isCalendarDay(day) || day < rule.anchor) return false;
  const index = firstAfterIndex(rule, day);
  // The occurrence just before the first one after `day` is the last one on or before it.
  const last = index === null ? lastIndex(rule) : index - 1;
  return last !== null && last >= 0 && occurrence(rule, last) === day;
}

/** The index of the last occurrence a rule has, or `null` for one that has no end (within the search's bound). */
function lastIndex(rule: Rule): number | null {
  if (rule.end === null) return null;
  const index = firstAfterIndex(rule, rule.end);
  return index === null ? null : index - 1;
}

/**
 * Every occurrence after `after` up to and including `to`, oldest first, at most `limit`. The same dates that posting in turn would make: the first is
 * `nextOccurrence(rule, after)`. Empty for a rule that has ended, or days that are not days.
 */
export function occurrencesBetween(rule: Rule, after: string, to: string, limit = 1000): string[] {
  if (checkRule(rule).length > 0 || !isCalendarDay(after) || !isCalendarDay(to) || after >= to)
    return [];
  const out: string[] = [];
  let index = firstAfterIndex(rule, after);
  while (index !== null && out.length < limit) {
    const date = occurrence(rule, index);
    if (date === null || date > to) break;
    out.push(date);
    index += 1;
  }
  return out;
}

/**
 * What a rule comes to in a month, for an amount of minor units each time (DESIGN.md §8.4): **daily × 365/12, weekly × 52/12, monthly ÷ N, yearly ÷ 12N**,
 * rounded half to even to the minor unit in integers. A yearly 600 repeating every year is 50 a month. `every` is N, so every 2 weeks is half of a weekly one.
 * An amount that is not a whole number of minor units is refused.
 */
export function monthlyEquivalent(rule: Pick<Rule, 'unit' | 'every'>, amount: number): number {
  if (!Number.isSafeInteger(amount)) throw new RangeError('monthlyEquivalent: not an amount');
  if (!Number.isInteger(rule.every) || rule.every < 1)
    throw new RangeError('monthlyEquivalent: not a repeat');
  const a = BigInt(amount);
  const n = BigInt(rule.every);
  const result =
    rule.unit === 'day'
      ? divideRoundHalfEven(a * 365n, 12n * n)
      : rule.unit === 'week'
        ? divideRoundHalfEven(a * 52n, 12n * n)
        : rule.unit === 'month'
          ? divideRoundHalfEven(a, n)
          : divideRoundHalfEven(a, 12n * n);
  return Number(result);
}

/** A rule in words, for a screen: "Every month", "Every 2 weeks, until 2027-06-30". */
export function describeRule(rule: Rule): string {
  const every = rule.every === 1 ? `Every ${rule.unit}` : `Every ${rule.every} ${rule.unit}s`;
  return rule.end === null ? every : `${every}, until ${rule.end}`;
}
