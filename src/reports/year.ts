import { isMonth, monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import type { Book } from '../ledger/books';
import { sumMinor } from '../money/amount';
import type { BudgetLine } from '../budget/screen';
import { type CategoryReport, type MonthReport, loadMonthReport } from './month';

/**
 * A year by month, category and subcategory (DESIGN.md §11.1): **the months summed, each at the budget it had then and the rates of its own days**, which is what the
 * month's report is made of, so a budget changed in July is 1 January's to June's old amount and July's to December's new one, never the new one throughout. Nothing
 * here converts or rounds: **it adds the months' figures**, each already in the base currency (or, for a category, in its own currency, which does not change), so
 * the year's total is the sum of the months' totals. **Pure** over the month reports. What a month left out for want of a rate is said once, with the month.
 */
export interface MonthFigure {
  readonly month: string;
  readonly received: number | null;
  readonly budgetedIncome: number | null;
  readonly spent: number | null;
  readonly budgetedSpending: number | null;
  readonly saved: number | null;
}

export interface CategoryYear {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  /** For each month of the year, in the category's currency; a month in which it had nothing is zero. */
  readonly months: readonly { month: string; budgeted: number; spent: number }[];
  readonly budgeted: number;
  readonly spent: number;
  readonly rows: readonly {
    readonly id: string;
    readonly name: string;
    readonly months: readonly { month: string; budgeted: number; spent: number }[];
    readonly budgeted: number;
    readonly spent: number;
  }[];
}

export interface YearReport {
  readonly year: string;
  readonly base: string | null;
  readonly months: readonly MonthFigure[];
  /** The year's totals, in the base currency; `null` while the book has none, or when a month could not give the figure. */
  readonly totals: {
    readonly received: number | null;
    readonly budgetedIncome: number | null;
    readonly spent: number | null;
    readonly budgetedSpending: number | null;
    readonly projected: number | null;
    readonly actual: number | null;
    readonly afterJars: number | null;
  };
  readonly categories: readonly CategoryYear[];
  readonly notIncluded: readonly string[];
}

/** The sum of the figures that are there, or `null` when there are none or any is missing: a total that leaves a month out says nothing. */
function total(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return sumMinor(values as number[]);
}

const rowOf = (line: BudgetLine) => ({
  id: line.subcategory.id,
  name: line.subcategory.name,
});

export function buildYearReport(year: string, months: readonly MonthReport[]): YearReport {
  const figures: MonthFigure[] = months.map((report) => ({
    month: report.month,
    received: report.income.received?.amount ?? null,
    budgetedIncome: report.income.budgeted?.amount ?? null,
    spent: report.budget.spent?.amount ?? null,
    budgetedSpending: report.budget.budgeted?.amount ?? null,
    saved: report.savings.actual,
  }));
  const byCategory = new Map<
    string,
    {
      head: Pick<CategoryReport, 'id' | 'name' | 'currency'>;
      months: Map<string, { budgeted: number; spent: number }>;
      rows: Map<
        string,
        { id: string; name: string; months: Map<string, { budgeted: number; spent: number }> }
      >;
    }
  >();
  for (const report of months)
    for (const category of report.categories) {
      const entry = byCategory.get(category.id) ?? {
        head: { id: category.id, name: category.name, currency: category.currency },
        months: new Map(),
        rows: new Map(),
      };
      entry.months.set(report.month, { budgeted: category.budgeted, spent: category.spent });
      for (const line of category.rows) {
        const sub = entry.rows.get(line.subcategory.id) ?? { ...rowOf(line), months: new Map() };
        sub.months.set(report.month, { budgeted: line.budgeted ?? 0, spent: line.spent.amount });
        entry.rows.set(line.subcategory.id, sub);
      }
      byCategory.set(category.id, entry);
    }
  const monthsOf = (have: Map<string, { budgeted: number; spent: number }>) =>
    months.map((report) => ({
      month: report.month,
      budgeted: have.get(report.month)?.budgeted ?? 0,
      spent: have.get(report.month)?.spent ?? 0,
    }));
  const categoryYears: CategoryYear[] = [...byCategory.values()].map((entry) => {
    const monthly = monthsOf(entry.months);
    return {
      ...entry.head,
      months: monthly,
      budgeted: sumMinor(monthly.map((each) => each.budgeted)),
      spent: sumMinor(monthly.map((each) => each.spent)),
      rows: [...entry.rows.values()].map((row) => {
        const rowMonthly = monthsOf(row.months);
        return {
          id: row.id,
          name: row.name,
          months: rowMonthly,
          budgeted: sumMinor(rowMonthly.map((each) => each.budgeted)),
          spent: sumMinor(rowMonthly.map((each) => each.spent)),
        };
      }),
    };
  });
  return {
    year,
    base: months[0]?.base ?? null,
    months: figures,
    totals: {
      received: total(figures.map((each) => each.received)),
      budgetedIncome: total(figures.map((each) => each.budgetedIncome)),
      spent: total(figures.map((each) => each.spent)),
      budgetedSpending: total(figures.map((each) => each.budgetedSpending)),
      projected: total(months.map((report) => report.savings.projected)),
      actual: total(months.map((report) => report.savings.actual)),
      afterJars: total(months.map((report) => report.savings.afterJars)),
    },
    categories: categoryYears,
    notIncluded: months.flatMap((report) =>
      report.notIncluded.map((line) => `${report.month}: ${line}`),
    ),
  };
}

/** The months of a year the book has lived through: January to December, or to the current month for the current year; none for a year that has not begun. */
export function monthsOfYear(year: string, today: string): string[] {
  if (!/^\d{4}$/.test(year)) return [];
  const current = monthOf(today);
  const out: string[] = [];
  for (let at = 1; at <= 12; at++) {
    const month = `${year}-${String(at).padStart(2, '0')}`;
    if (month <= current && isMonth(month)) out.push(month);
  }
  return out;
}

/** Loads a year: each of its months' report, then summed. Reads only the account's own book. */
export async function loadYearReport(
  database: Database,
  accountId: string,
  book: Book,
  year: string,
  now: Date = new Date(),
): Promise<YearReport> {
  const months = monthsOfYear(year, todayIn(book.timeZone, now));
  const reports: MonthReport[] = [];
  for (const month of months)
    reports.push(await loadMonthReport(database, accountId, book, month, now));
  return buildYearReport(year, reports);
}
