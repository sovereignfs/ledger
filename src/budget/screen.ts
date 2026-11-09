import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { isMonth, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { loadRates } from '../fx/rates';
import type { Book } from '../ledger/books';
import { sumMinor } from '../money/amount';
import {
  type ConvertedTotal,
  type Dated,
  type NotIncluded,
  type RateSource,
  convertedTotal,
} from '../money/convert';
import { budgetsForMonth } from './amounts';
import { lastDayOf } from './income';
import type { CategoryRow } from './categories';
import { listCategories } from './categories';

/**
 * What the Budget screen shows (DESIGN.md §7.2): for a month, every subcategory's **budgeted** amount (the one in force, §7.3) and what was **spent**, the sum of
 * its lines on entries dated in the month **converted to its category's currency at each entry's own date** (§9.3), rolled up to the category and the budget and
 * converted to the base currency for the totals. A split counts in each of its parts' subcategories. **Pure over rows and rates**, so the screen and the month's
 * report (8.1) have one implementation and the tests need no database. An amount with no rate is left out and **said, never counted as nothing**.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

/** One amount spent: a subcategory's lines on one day, in the currency of the entry, positive for spending and negative for money back. */
export interface Spent {
  readonly subcategoryId: string;
  readonly currency: string;
  readonly date: string;
  readonly amount: number;
}

export interface BudgetLine {
  readonly subcategory: {
    id: string;
    name: string;
    budgetSource: 'manual' | 'bills';
    archived: boolean;
  };
  readonly category: { id: string; name: string; currency: string };
  /** In the category's currency; `null` when no budget is in force yet, which is not a budget of nothing. */
  readonly budgeted: number | null;
  /** In the category's currency, with what could not be converted into it. */
  readonly spent: ConvertedTotal;
  /** By how much it is over its budget, or 0. */
  readonly over: number;
}

export interface BudgetGroup {
  readonly id: 'bills' | 'spending' | 'saving';
  readonly title: string;
  readonly rows: readonly BudgetLine[];
}

export interface BudgetFigures {
  readonly month: string;
  readonly groups: readonly BudgetGroup[];
  readonly base: string | null;
  /** In the base currency; `null` while the book has none. With what was left out, from a row's own conversion and from the rolling up. */
  readonly budgeted: ConvertedTotal | null;
  readonly spent: ConvertedTotal | null;
  readonly byCurrency: {
    budgeted: readonly { currency: string; amount: number }[];
    spent: readonly { currency: string; amount: number }[];
  };
}

const GROUPS: { id: BudgetGroup['id']; title: string }[] = [
  { id: 'bills', title: 'Bills' },
  { id: 'spending', title: 'Spending' },
  { id: 'saving', title: 'Saving' },
];

function mergeNotIncluded(...lists: readonly (readonly NotIncluded[])[]): NotIncluded[] {
  const by = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const list of lists)
    for (const item of list) {
      by.set(item.currency, [...(by.get(item.currency) ?? []), item.amount]);
      counts.set(item.currency, (counts.get(item.currency) ?? 0) + item.count);
    }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, amounts]) => ({
      currency,
      count: counts.get(currency) ?? 0,
      amount: sumMinor(amounts),
    }));
}

export function buildBudget(input: {
  month: string;
  categories: readonly Pick<
    CategoryRow,
    'id' | 'name' | 'currency' | 'archivedAt' | 'subcategories'
  >[];
  budgets: ReadonlyMap<string, number>;
  spent: readonly Spent[];
  base: string | null;
  rates: RateSource;
  /** The day budgeted amounts, which are of a month and not a day, are converted at: the month's end, or today while it is not over. */
  budgetDate: string;
}): BudgetFigures {
  const { month, categories, budgets, spent, base, rates, budgetDate } = input;
  const rows: BudgetLine[] = [];
  for (const category of categories) {
    for (const sub of category.subcategories) {
      const mine = spent.filter((each) => each.subcategoryId === sub.id);
      const budgeted = budgets.get(`subcategory:${sub.id}`) ?? null;
      const archived = category.archivedAt !== null || sub.archivedAt !== null;
      // An archived subcategory is shown only while it has something to show in this month.
      if (archived && mine.length === 0 && (budgeted ?? 0) === 0) continue;
      const total = convertedTotal(
        mine.map((each): Dated => ({
          amount: each.amount,
          currency: each.currency,
          date: each.date,
        })),
        category.currency,
        rates,
      );
      rows.push({
        subcategory: { id: sub.id, name: sub.name, budgetSource: sub.budgetSource, archived },
        category: { id: category.id, name: category.name, currency: category.currency },
        budgeted,
        spent: total,
        over: budgeted !== null && total.amount > budgeted ? total.amount - budgeted : 0,
      });
    }
  }
  const groups: BudgetGroup[] = GROUPS.map(({ id, title }) => ({
    id,
    title,
    rows:
      id === 'bills'
        ? rows.filter((row) => row.subcategory.budgetSource === 'bills')
        : id === 'spending'
          ? rows.filter((row) => row.subcategory.budgetSource !== 'bills')
          : [],
  }));

  // Rolling up: each category's rows share its currency, so a category's budgeted and spent are exact sums; the categories are then converted to the base currency.
  const byCategory = new Map<string, { currency: string; budgeted: number[]; spent: number[] }>();
  for (const row of rows) {
    const entry = byCategory.get(row.category.id) ?? {
      currency: row.category.currency,
      budgeted: [],
      spent: [],
    };
    entry.budgeted.push(row.budgeted ?? 0);
    entry.spent.push(row.spent.amount);
    byCategory.set(row.category.id, entry);
  }
  const categoryItems = (field: 'budgeted' | 'spent'): Dated[] =>
    [...byCategory.values()].map((entry) => ({
      amount: sumMinor(entry[field]),
      currency: entry.currency,
      date: budgetDate,
    }));
  const sums = (field: 'budgeted' | 'spent') => {
    const by = new Map<string, number[]>();
    for (const item of categoryItems(field))
      by.set(item.currency, [...(by.get(item.currency) ?? []), item.amount]);
    return [...by.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([currency, amounts]) => ({ currency, amount: sumMinor(amounts) }));
  };
  const rowsNotIncluded = mergeNotIncluded(...rows.map((row) => row.spent.notIncluded));
  const rolled = (field: 'budgeted' | 'spent'): ConvertedTotal | null => {
    if (base === null) return null;
    const total = convertedTotal(categoryItems(field), base, rates);
    return field === 'spent'
      ? { ...total, notIncluded: mergeNotIncluded(total.notIncluded, rowsNotIncluded) }
      : total;
  };
  return {
    month,
    groups,
    base,
    budgeted: rolled('budgeted'),
    spent: rolled('spent'),
    byCurrency:
      base === null
        ? { budgeted: sums('budgeted'), spent: sums('spent') }
        : { budgeted: [], spent: [] },
  };
}

/** What was spent in a month: the subcategory lines of the account's entries dated in it, one amount for each subcategory, currency and day. */
export async function spentInMonth(
  database: Database,
  accountId: string,
  bookId: string,
  month: string,
): Promise<Spent[]> {
  if (!isMonth(month)) throw new RangeError('spentInMonth: not a month');
  const s = schema(database);
  const rows = await dbAll<{
    subcategoryId: string;
    currency: string;
    date: string;
    amount: number | string;
  }>(
    database,
    sql`SELECT l.subcategory_id AS "subcategoryId", l.currency AS currency, t.date AS date, SUM(l.amount) AS amount
          FROM ${s.txnLine} l JOIN ${s.txn} t ON t.id = l.txn_id AND t.book_id = l.book_id
         WHERE l.book_id = ${bookId} AND ${inBook(database, sql`l.book_id`, accountId)}
           AND l.subcategory_id IS NOT NULL AND t.date >= ${`${month}-01`} AND t.date <= ${lastDayOf(month)}
         GROUP BY l.subcategory_id, l.currency, t.date
         ORDER BY t.date, l.subcategory_id`,
  );
  return rows.map((row) => ({
    subcategoryId: row.subcategoryId,
    currency: row.currency,
    date: row.date,
    amount: Number(row.amount),
  }));
}

/** Loads a month: the categories, the budgets in force, what was spent, and the rates for the days it falls on. Reads only the account's own book. */
export async function loadBudget(
  database: Database,
  accountId: string,
  book: Book,
  month: string,
  now: Date = new Date(),
): Promise<BudgetFigures> {
  const [categories, budgets, spent] = await Promise.all([
    listCategories(database, accountId, book.id),
    budgetsForMonth(database, accountId, book.id, month),
    spentInMonth(database, accountId, book.id, month),
  ]);
  const today = todayIn(book.timeZone, now);
  const end = lastDayOf(month);
  const budgetDate = today >= `${month}-01` && today < end ? today : end;
  const currencies = [
    ...new Set([
      ...categories.map((c) => c.currency),
      ...spent.map((each) => each.currency),
      ...(book.baseCurrency ? [book.baseCurrency] : []),
    ]),
  ];
  const rates = await loadRates(database, currencies, `${month}-01`, end);
  return buildBudget({
    month,
    categories,
    budgets,
    spent,
    base: book.baseCurrency,
    rates,
    budgetDate,
  });
}
