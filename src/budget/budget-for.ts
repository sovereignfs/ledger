/**
 * The budget in force for a month (DESIGN.md §7.3), **pure** over rows: a target's budgeted amount is effective-dated, and the amount for a month is the one of
 * the latest row whose `from_month` is not after it. A month before the first row has no budget, which is not a budget of nothing. Months are `YYYY-MM` text,
 * which compares in month order.
 */
export interface BudgetRow {
  /** `YYYY-MM`. */
  readonly fromMonth: string;
  /** Minor units of the target's currency; zero when a budget has ended. */
  readonly amount: number;
}

/** The amount in force for `month`, or `undefined` when no row is in force yet. The rows may come in any order. */
export function budgetFor(rows: readonly BudgetRow[], month: string): number | undefined {
  let found: BudgetRow | undefined;
  for (const row of rows) {
    if (row.fromMonth > month) continue;
    if (found === undefined || row.fromMonth > found.fromMonth) found = row;
  }
  return found?.amount;
}
