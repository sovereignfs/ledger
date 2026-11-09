import { addMonths } from '../dates';
import { formatMoney } from '../money/text';

/**
 * Insights (DESIGN.md §12): **rule-based, worked out when a page needs them and never stored**, each in plain words with a link. A rule needs enough history to speak, so a new
 * book shows none. The rules are **pure** over rows, so that Overview, a month's report and the recap read one implementation and a test needs no database; each rule has a test
 * that sees it fire and one that sees it stay silent.
 *
 *  - **Over budget again:** a subcategory spent more than was budgeted for N consecutive completed months (N = 2), counting back from the last completed month.
 *  - **Unusually large:** an expense of more than three times the median of its subcategory's expenses over the six months before it, with at least five to compare.
 */
export interface Insight {
  /** Stable for the same finding, for a list's keys and for a recap that says it once. */
  readonly id: string;
  readonly kind: 'over_budget_again' | 'unusually_large';
  /** A sentence. */
  readonly text: string;
  /** Where to look, relative to the app. */
  readonly href: string;
}

/** What a subcategory came to in a completed month: budgeted (`null` when none was in force) and spent, in its category's currency. */
export interface MonthRow {
  readonly subcategoryId: string;
  readonly name: string;
  readonly currency: string;
  readonly budgeted: number | null;
  readonly spent: number;
}

export interface CompletedMonth {
  readonly month: string;
  readonly rows: readonly MonthRow[];
}

export const OVER_BUDGET_MONTHS = 2;

/**
 * The subcategories over budget in each of the last `n` consecutive completed months. `months` are the completed months, **newest first**; they must be consecutive
 * (a gap, or too few, means there is not enough to say) and the newest is the last completed month. A row with no budget in force is not over it.
 */
export function overBudgetAgain(
  months: readonly CompletedMonth[],
  n: number = OVER_BUDGET_MONTHS,
  locale?: string,
): Insight[] {
  const recent = months.slice(0, n);
  if (n < 1 || recent.length < n) return [];
  for (let at = 1; at < recent.length; at++)
    if (
      addMonths((recent[at] as CompletedMonth).month, 1) !==
      (recent[at - 1] as CompletedMonth).month
    )
      return [];
  const over = (month: CompletedMonth) =>
    new Map(
      month.rows
        .filter((row) => row.budgeted !== null && row.budgeted > 0 && row.spent > row.budgeted)
        .map((row) => [row.subcategoryId, row] as const),
    );
  const [newest, ...older] = recent as [CompletedMonth, ...CompletedMonth[]];
  const insights: Insight[] = [];
  for (const [id, row] of over(newest)) {
    if (!older.every((month) => over(month).has(id))) continue;
    insights.push({
      id: `over:${id}:${newest.month}`,
      kind: 'over_budget_again',
      text: `${row.name} was over its budget in each of the last ${n} months, by ${formatMoney(row.spent - (row.budgeted ?? 0), row.currency, locale)} in ${newest.month}.`,
      href: `/budget?month=${newest.month}&row=${id}`,
    });
  }
  return insights.sort((a, b) => (a.text < b.text ? -1 : 1));
}

/** One expense on a subcategory: its entry, day, the subcategory's name and the amount (more than nothing) in the currency of the line. */
export interface ExpenseLine {
  readonly txnId: string;
  readonly date: string;
  readonly subcategoryId: string;
  readonly name: string;
  readonly currency: string;
  readonly amount: number;
}

export const LARGE_TIMES = 3;
export const LARGE_MIN_COMPARE = 5;
export const LARGE_MONTHS = 6;

/** The median of whole amounts: the middle one, or the mean of the two middle ones rounded half to even. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  const sum = (sorted[mid - 1] as number) + (sorted[mid] as number);
  const half = sum / 2;
  if (Number.isInteger(half)) return half;
  const floor = Math.floor(half);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** The day `count` months before `date`, in the month's own length (the 31st of a month with fewer days is its last). */
function monthsBefore(date: string, count: number): string {
  const month = addMonths(date.slice(0, 7), -count);
  const last = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8)), last)).padStart(2, '0')}`;
}

/**
 * The expenses in `[from, to]` that are more than three times the median of their subcategory's other expenses, in the same currency, over the six months before
 * them, **when there are at least five to compare**. An expense is not compared with itself, nor with ones after it. Newest first.
 */
export function unusuallyLarge(
  expenses: readonly ExpenseLine[],
  window: { from: string; to: string },
  locale?: string,
): Insight[] {
  const found: Insight[] = [];
  for (const line of expenses) {
    if (line.date < window.from || line.date > window.to || line.amount <= 0) continue;
    const since = monthsBefore(line.date, LARGE_MONTHS);
    const others = expenses.filter(
      (other) =>
        other !== line &&
        other.subcategoryId === line.subcategoryId &&
        other.currency === line.currency &&
        other.amount > 0 &&
        other.date >= since &&
        other.date <= line.date &&
        !(other.date === line.date && other.txnId >= line.txnId),
    );
    if (others.length < LARGE_MIN_COMPARE) continue;
    const typical = median(others.map((other) => other.amount));
    if (typical > 0 && line.amount > LARGE_TIMES * typical)
      found.push({
        id: `large:${line.txnId}:${line.subcategoryId}`,
        kind: 'unusually_large',
        text: `${formatMoney(line.amount, line.currency, locale)} on ${line.name} on ${line.date} is more than three times the usual ${formatMoney(typical, line.currency, locale)}.`,
        href: `/transactions?subcategory=${line.subcategoryId}`,
      });
  }
  return found.sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** Every insight there is, **over budget again first** and then the unusually large; `limit` keeps the first few (Overview shows at most three). */
export function allInsights(
  input: {
    months: readonly CompletedMonth[];
    expenses: readonly ExpenseLine[];
    window: { from: string; to: string };
    locale?: string;
  },
  limit?: number,
): Insight[] {
  const all = [
    ...overBudgetAgain(input.months, OVER_BUDGET_MONTHS, input.locale),
    ...unusuallyLarge(input.expenses, input.window, input.locale),
  ];
  return limit === undefined ? all : all.slice(0, limit);
}
