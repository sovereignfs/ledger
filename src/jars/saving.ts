import { budgetsForMonth } from '../budget/amounts';
import type { Database } from '../db/client';
import { type JarRow, listJars, progress } from './jars';

/**
 * What the Saving group of the budget shows (DESIGN.md §10.3): each jar with its monthly contribution in force for the month, its balance and its progress
 * to its target. **Contributions are not spending**: they are not in the budget's totals. The builder is **pure**, so the screen and the tests share it.
 */
export interface SavingRow {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly currency: string;
  /** The contribution in force for the month; `null` when none is set, which is not a contribution of nothing. */
  readonly monthly: number | null;
  readonly balance: number;
  readonly target: number | null;
  /** From 0 to 1, or `null` without a target. */
  readonly progress: number | null;
}

export function buildSaving(
  jars: readonly JarRow[],
  budgets: ReadonlyMap<string, number>,
): SavingRow[] {
  return jars.map((jar) => ({
    id: jar.id,
    name: jar.name,
    accountId: jar.accountId,
    accountName: jar.accountName,
    currency: jar.currency,
    monthly: budgets.get(`jar:${jar.id}`) ?? null,
    balance: jar.balance,
    target: jar.target,
    progress: progress(jar.balance, jar.target),
  }));
}

/** Loads the jars of the person's book for a month, with their contributions in force. */
export async function loadSaving(
  database: Database,
  accountId: string,
  bookId: string,
  month: string,
): Promise<SavingRow[]> {
  const [jars, budgets] = await Promise.all([
    listJars(database, accountId, bookId),
    budgetsForMonth(database, accountId, bookId, month),
  ]);
  return buildSaving(jars, budgets);
}
