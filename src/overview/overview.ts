import { monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { loadOverview, type Overview } from '../accounts/overview';
import { listAccounts } from '../ledger/accounts';
import type { Book } from '../ledger/books';
import { listEntries, type ListedEntry } from '../ledger/entry-list';
import { listIncomeSources } from '../budget/income-sources';
import { loadIncome, type IncomeFigures } from '../budget/income';
import { loadBudget, type BudgetFigures, type BudgetLine } from '../budget/screen';
import type { ConvertedTotal } from '../money/convert';
import { listUpcoming, type Upcoming } from '../recurring/recurring';

/**
 * What Overview shows (DESIGN.md §14.3): this month's income received, spent, and saved (what was planned and what actually was), net worth, the budget rows
 * closest to or over their budget, recent transactions, and the checklist of what is left to set up. **The figures are the budget screen's and the income
 * page's own** (`loadBudget`, `loadIncome`, `loadOverview`): Overview adds none of its own arithmetic but the two differences below, so it agrees with them and
 * with the month's report (8.1) by construction. The parts that are logic are **pure**, so they are tested with no database.
 */
export interface ThisMonth {
  readonly month: string;
  readonly base: string | null;
  /** In the base currency; `null` while the book has none. */
  readonly received: ConvertedTotal | null;
  readonly spent: ConvertedTotal | null;
  /** What the budget plans to save: budgeted income less budgeted spending; `null` while there is no base currency. */
  readonly projectedSaved: number | null;
  /** What was saved so far: income received less spent; `null` while there is no base currency. */
  readonly actualSaved: number | null;
  /** What either figure left out for want of a rate, said in words. */
  readonly notIncluded: readonly string[];
}

/** This month's figures from the income and budget figures of the same month. Saved is a difference of two figures, with nothing converted again. */
export function thisMonth(income: IncomeFigures, budget: BudgetFigures): ThisMonth {
  const lines = (label: string, total: ConvertedTotal | null) =>
    (total?.notIncluded ?? []).map(
      ({ count, currency }) =>
        `${label}: ${count} ${count === 1 ? 'amount' : 'amounts'} in ${currency} not included`,
    );
  const planned =
    income.budgeted && budget.budgeted ? income.budgeted.amount - budget.budgeted.amount : null;
  const actual =
    income.received && budget.spent ? income.received.amount - budget.spent.amount : null;
  return {
    month: budget.month,
    base: budget.base,
    received: income.received,
    spent: budget.spent,
    projectedSaved: planned,
    actualSaved: actual,
    notIncluded: [
      ...lines('Income', income.received),
      ...lines('Spent', budget.spent),
      ...lines('Budgeted income', income.budgeted),
      ...lines('Budgeted spending', budget.budgeted),
    ],
  };
}

export interface CloseRow {
  readonly line: BudgetLine;
  /** Spent as a fraction of budgeted, in the category's own currency: 1 is all of it, more is over. */
  readonly used: number;
}

/**
 * The rows closest to, or over, their budget: those with a budget in force, most used first (over ones before the rest), at most `limit`. A row with no budget
 * is not in it, since it has nothing to be close to; a row with nothing spent is not either.
 */
export function closestRows(budget: BudgetFigures, limit = 5): CloseRow[] {
  return budget.groups
    .flatMap((group) => group.rows)
    .filter((line) => line.budgeted !== null && line.budgeted > 0 && line.spent.amount > 0)
    .map((line) => ({ line, used: line.spent.amount / (line.budgeted as number) }))
    .sort((a, b) => b.used - a.used || (a.line.subcategory.name < b.line.subcategory.name ? -1 : 1))
    .slice(0, limit);
}

export interface ChecklistItem {
  readonly id: 'accounts' | 'debts' | 'income' | 'bills' | 'jars' | 'people';
  readonly label: string;
  readonly done: boolean;
  /** Where it is done, or `null` for what is not built yet (bills, jars). */
  readonly href: string | null;
  readonly note?: string;
}

/**
 * The setup checklist (DESIGN.md §15.3): what the wizard does not ask, in any order: more accounts, cards and loans, secondary income, bills, jars, people.
 * Each is **done when the book has one**. Bills and jars are not built yet, so they have nowhere to go and are never done.
 */
export function checklist(facts: {
  accounts: readonly { type: string }[];
  sources: readonly { kind: string; archivedAt: number | null }[];
}): ChecklistItem[] {
  const live = (type: string) => facts.accounts.filter((account) => account.type === type).length;
  return [
    {
      id: 'accounts',
      label: 'Add another account',
      done: facts.accounts.length > 1,
      href: '/accounts',
    },
    {
      id: 'debts',
      label: 'Add a credit card or a loan',
      done: live('credit_card') + live('loan') > 0,
      href: '/accounts',
    },
    {
      id: 'income',
      label: 'Add a second source of income',
      done: facts.sources.some(
        (source) => source.kind === 'secondary' && source.archivedAt === null,
      ),
      href: '/budget/income',
    },
    {
      id: 'bills',
      label: 'Add the bills you pay every month',
      done: false,
      href: null,
      note: 'Coming soon',
    },
    { id: 'jars', label: 'Set money aside in a jar', done: false, href: null, note: 'Coming soon' },
    {
      id: 'people',
      label: 'Add someone you lend to or owe',
      done: live('person') > 0,
      href: '/accounts',
    },
  ];
}

export interface OverviewPage {
  readonly month: string;
  readonly thisMonth: ThisMonth;
  readonly worth: Overview;
  readonly close: readonly CloseRow[];
  readonly recent: readonly ListedEntry[];
  readonly checklist: readonly ChecklistItem[];
  /** Bills that ask first, waiting to be confirmed, overdue ones included. */
  readonly upcoming: readonly Upcoming[];
  readonly hasAccounts: boolean;
}

/** Loads Overview: every figure from the account's own book, through the same functions the other screens use. */
export async function loadOverviewPage(
  database: Database,
  accountId: string,
  book: Book,
  now: Date = new Date(),
): Promise<OverviewPage> {
  const month = monthOf(todayIn(book.timeZone, now));
  const [income, budget, worth, recent, accounts, sources, upcoming] = await Promise.all([
    loadIncome(database, accountId, book, month, now),
    loadBudget(database, accountId, book, month, now),
    loadOverview(database, accountId, book, now),
    listEntries(database, accountId, book.id, {}, undefined, 8),
    listAccounts(database, accountId, book.id),
    listIncomeSources(database, accountId, book.id),
    listUpcoming(database, accountId, book.id, book.timeZone, now),
  ]);
  return {
    month,
    thisMonth: thisMonth(income, budget),
    worth,
    close: closestRows(budget),
    recent: recent.entries,
    checklist: checklist({ accounts, sources }),
    upcoming,
    hasAccounts: accounts.length > 0,
  };
}
