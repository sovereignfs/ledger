import type { EntryLine, ListedEntry } from '../ledger/entry-list';

/**
 * How a row of the transactions list reads (DESIGN.md §6.9): when, who or what, which category (or "Split"), which account, and an amount. **Pure** over a listed
 * entry, so every kind of row is tested with no browser. An amount keeps its sign here, since it is a movement, and the words for what is owed are the
 * accounts' (`src/ledger/present.ts`).
 */
const TYPE_LABEL: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  opening: 'Opening balance',
  adjustment: 'Adjustment',
  revaluation: 'Value updated',
};

export interface Row {
  readonly id: string;
  readonly date: string;
  /** The payee, or the entry's own note, or what kind of entry it is. */
  readonly title: string;
  /** The subcategory (with its category), the income source, "Split", or what kind of entry it is. */
  readonly category: string;
  /** The account, or "From → To" for a transfer. */
  readonly account: string;
  /** Each part of a split, with its amount, for a hover and a detail; empty for an entry that is not split. */
  readonly parts: readonly { label: string; amount: number; currency: string }[];
  /** The signed movement: on the one account filtered if there is one, else on the account that paid or received. */
  readonly amount: number;
  readonly currency: string;
  /** What arrived, when a transfer is between two currencies. */
  readonly received: { amount: number; currency: string } | null;
  readonly status: 'pending' | 'cleared';
  readonly balanceAfter: number | null;
}

const accountLines = (entry: ListedEntry): EntryLine[] =>
  entry.lines.filter((line) => line.account);
const targets = (entry: ListedEntry): EntryLine[] =>
  entry.lines.filter((line) => line.subcategory || line.incomeSource);

export function describeEntry(entry: ListedEntry, filteredAccount?: string): Row {
  const accounts = accountLines(entry);
  const parts = targets(entry);
  let category = TYPE_LABEL[entry.type] ?? entry.type;
  if (entry.type === 'expense' || entry.type === 'income') {
    const first = parts[0];
    category =
      parts.length > 1
        ? 'Split'
        : first?.subcategory
          ? first.subcategory.category
            ? `${first.subcategory.name} · ${first.subcategory.category}`
            : first.subcategory.name
          : (first?.incomeSource?.name ?? category);
  }
  const names = accounts.map((line) => line.account?.name ?? '');
  let account = names.join(' + ');
  let amount = accounts[0]?.amount ?? 0;
  let currency = accounts[0]?.currency ?? 'USD';
  let received: Row['received'] = null;
  if (entry.type === 'transfer') {
    const from = accounts.find((line) => line.amount < 0) ?? accounts[0];
    const to = accounts.find((line) => line !== from);
    account = `${from?.account?.name ?? ''} → ${to?.account?.name ?? ''}`;
    amount = from?.amount ?? 0;
    currency = from?.currency ?? currency;
    if (to && from && to.currency !== from.currency)
      received = { amount: to.amount, currency: to.currency };
  }
  if (filteredAccount) {
    const own = accounts.filter((line) => line.account?.id === filteredAccount);
    if (own.length > 0) {
      amount = own.reduce((sum, line) => sum + line.amount, 0);
      currency = own[0]?.currency ?? currency;
      received = null;
    }
  }
  return {
    id: entry.id,
    date: entry.date,
    title: entry.payee?.name ?? (entry.note ? entry.note : (TYPE_LABEL[entry.type] ?? entry.type)),
    category,
    account,
    parts:
      parts.length > 1
        ? parts.map((line) => ({
            label: line.subcategory?.name ?? line.incomeSource?.name ?? '',
            amount: Math.abs(line.amount),
            currency: line.currency,
          }))
        : [],
    amount,
    currency,
    received,
    status: entry.status,
    balanceAfter: entry.balanceAfter,
  };
}
