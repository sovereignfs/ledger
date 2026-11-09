import { addMonths, monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { loadInsights } from '../insights/load';
import type { Insight } from '../insights/rules';
import type { Book } from '../ledger/books';
import type { ConvertedTotal } from '../money/convert';
import { formatMoney } from '../money/text';
import { type MonthReport, loadMonthReport } from '../reports/month';
import { type Channel, type Outgoing, fanOut } from './channels';
import { claimMark } from './marks';

/**
 * **The recap** (DESIGN.md §11.5, task 8.6): on the 1st, in the book's own calendar, last month's figures: what came in, what was spent, what was saved, the three categories
 * furthest over their budget and any insight, with a link to the month's report. **The figures are `loadMonthReport`'s own**: this adds no arithmetic of its own but a ratio to
 * rank the categories by, so the recap agrees with Reports by construction. Totals are in the base currency; a category is in its own. What a figure left out for want of a rate
 * is said, never counted as nothing. The words are "budgeted" and "spent".
 *
 * It goes by the bell and by email where there is a channel (`channels.ts`), once for a book and month (claimed first, `marks.ts`), only for a book with the recap on, and **nothing is
 * claimed with no channel at all**. It is sent on the first days of the month and not after them, so a server that was down on the 1st still sends it, and turning the recap on near
 * the end of a month does not send a month long gone.
 */
export const RECAP_DAYS = 7;

export interface RecapFigures {
  readonly month: string;
  readonly locale: string | null;
  readonly base: string | null;
  readonly received: ConvertedTotal | null;
  readonly spent: ConvertedTotal | null;
  readonly budgeted: ConvertedTotal | null;
  readonly savings: { readonly actual: number | null; readonly afterJars: number | null };
  /** The categories over their budget, in their own currencies. */
  readonly over: readonly { name: string; currency: string; budgeted: number; over: number }[];
  readonly insights: readonly string[];
  readonly notIncluded: readonly string[];
}

/** The month as a person reads it (`October 2026`), in the book's locale, or in English where there is none or it is not one. */
export function monthLabel(month: string, locale: string | null): string {
  const at = new Date(`${month}-01T00:00:00Z`);
  for (const tag of [locale ?? undefined, 'en']) {
    try {
      return new Intl.DateTimeFormat(tag, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(at);
    } catch {
      // Not a locale the runtime knows: the next one.
    }
  }
  return month;
}

/** The report's figures for a recap: the three categories furthest over (by how much of their budget the excess is, which compares currencies without converting them), and the insights. */
export function figuresOf(
  report: MonthReport,
  insights: readonly Insight[],
  locale: string | null,
): RecapFigures {
  const over = report.categories
    .filter((category) => category.over > 0 && category.budgeted > 0)
    .map((category) => ({
      name: category.name,
      currency: category.currency,
      budgeted: category.budgeted,
      over: category.over,
    }))
    .sort((a, b) => b.over / b.budgeted - a.over / a.budgeted || (a.name < b.name ? -1 : 1))
    .slice(0, 3);
  return {
    month: report.month,
    locale,
    base: report.base,
    received: report.income.received,
    spent: report.budget.spent,
    budgeted: report.budget.budgeted,
    savings: { actual: report.savings.actual, afterJars: report.savings.afterJars },
    over,
    insights: insights.map((insight) => insight.text),
    notIncluded: report.notIncluded,
  };
}

/**
 * Whether there is anything to say: a book with no base currency has no totals, and a month in which nothing came in and nothing was spent has no recap, whatever was budgeted for it.
 */
export function hasSomethingToSay(figures: RecapFigures): boolean {
  if (!figures.base) return false;
  return (figures.received?.amount ?? 0) !== 0 || (figures.spent?.amount ?? 0) !== 0;
}

/** The recap as a notice: a title and a short body for the bell, and the subject and text of the email. Pure. */
export function recapNotice(
  figures: RecapFigures,
): Pick<Outgoing, 'title' | 'body' | 'path' | 'email'> {
  const label = monthLabel(figures.month, figures.locale);
  const base = figures.base ?? '';
  const money = (minor: number, currency = base) =>
    formatMoney(minor, currency, figures.locale ?? undefined);
  const total = (value: ConvertedTotal | null) => (value ? money(value.amount) : null);
  const spent = total(figures.spent);
  const budgeted = total(figures.budgeted);
  const received = total(figures.received);
  const saved = figures.savings.actual === null ? null : money(figures.savings.actual);

  const lines: string[] = [];
  if (received) lines.push(`Income received: ${received}`);
  if (spent) lines.push(`Spent: ${spent}${budgeted ? ` of ${budgeted} budgeted` : ''}`);
  if (saved) lines.push(`Saved: ${saved}`);
  if (figures.savings.afterJars !== null && figures.savings.afterJars !== figures.savings.actual)
    lines.push(`Saved after what went into jars: ${money(figures.savings.afterJars)}`);
  for (const note of figures.notIncluded) lines.push(`Not included: ${note}`);

  const overLines = figures.over.map(
    (each) =>
      `${each.name}: ${money(each.over, each.currency)} over its ${money(each.budgeted, each.currency)} budgeted`,
  );
  const body = [
    ...(spent ? [`Spent ${spent}${budgeted ? ` of ${budgeted} budgeted` : ''}`] : []),
    ...(saved ? [`saved ${saved}`] : []),
  ]
    .join('; ')
    .replace(/^./, (first) => first.toUpperCase());
  const path = `/reports?month=${figures.month}`;
  const text = [
    `Here is ${label}.`,
    '',
    ...lines,
    ...(overLines.length > 0
      ? ['', 'Furthest over budget:', ...overLines.map((line) => `- ${line}`)]
      : []),
    ...(figures.insights.length > 0
      ? ['', 'Worth a look:', ...figures.insights.map((line) => `- ${line}`)]
      : []),
  ].join('\n');
  return {
    title: `Your ${label} recap`,
    ...(body ? { body: `${body}.` } : {}),
    path,
    email: { subject: `Your budget for ${label}`, text },
  };
}

/** Whether the recap is due for this book today: the first days of a month, by the book's own calendar. Returns the month to recap (the one before), or `null`. */
export function recapMonthFor(timeZone: string, now: Date): string | null {
  const today = todayIn(timeZone, now);
  const day = Number(today.slice(8, 10));
  return day <= RECAP_DAYS ? addMonths(monthOf(today), -1) : null;
}

/**
 * Sends the book's recap if it is due and wanted, claiming it first. Returns whether it was claimed. A book with the recap off, with nothing to say or with no channel claims
 * nothing, so it is looked at again the next hour.
 */
export async function sendRecap(
  database: Database,
  channels: readonly Channel[],
  owner: string,
  book: Book,
  now: Date,
  log: (line: string) => void,
): Promise<boolean> {
  if (channels.length === 0 || !book.recap) return false;
  const month = recapMonthFor(book.timeZone, now);
  if (!month) return false;
  const [report, insights] = await Promise.all([
    loadMonthReport(database, owner, book, month, now),
    loadInsights(database, owner, book, now, { limit: 3 }),
  ]);
  const figures = figuresOf(report, insights, book.locale);
  if (!hasSomethingToSay(figures)) return false;
  if (!(await claimMark(database, owner, book.id, 'recap', month, now.getTime()))) return false;
  await fanOut(
    channels,
    {
      accountId: owner,
      kind: 'recap',
      key: `recap:${book.id}:${month}`,
      ...recapNotice(figures),
    },
    log,
  );
  return true;
}
