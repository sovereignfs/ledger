import type { Database } from '../db/client';
import { todayIn } from '../dates';
import { loadRates } from '../fx/rates';
import { type AccountRow, listAccounts } from '../ledger/accounts';
import { ACCOUNT_KINDS, type Side } from '../ledger/account-types';
import type { Book } from '../ledger/books';
import { sumMinor } from '../money/amount';
import { type ConvertedTotal, type RateSource, convertedTotal } from '../money/convert';

/**
 * What the Accounts screen shows (DESIGN.md §6.1, §14.3): the live accounts in three groups (what you have, what you owe, people), and the net worth. The
 * arithmetic is here, **pure**, over rows and rates, so that the screen is only drawing and the figures are tested with no database and no clock.
 *
 * **Net worth is every balance converted to the book's base currency at today's rates** and added: a liability's balance is negative, so what is owed comes
 * off. An account in a currency with no rate is **not included, and the total says so** (§9.3). A book with no base currency yet (setup, task 9.1, chooses it)
 * has no net worth to convert to, and shows one total for each currency instead.
 */
export interface AccountGroup {
  readonly id: 'assets' | 'liabilities' | 'people';
  readonly title: string;
  readonly accounts: readonly AccountRow[];
}

const GROUPS: { id: AccountGroup['id']; title: string; side: Side }[] = [
  { id: 'assets', title: 'What you have', side: 'asset' },
  { id: 'liabilities', title: 'What you owe', side: 'liability' },
  { id: 'people', title: 'People', side: 'either' },
];

/** The accounts in their three groups, each in the order they were made; a group with nothing in it is left out. */
export function groupAccounts(rows: readonly AccountRow[]): AccountGroup[] {
  return GROUPS.map(({ id, title, side }) => ({
    id,
    title,
    accounts: rows.filter((row) => ACCOUNT_KINDS[row.type].side === side),
  })).filter((group) => group.accounts.length > 0);
}

export interface NetWorth {
  /** In the base currency, with what could not be converted; null when the book has no base currency yet. */
  readonly total: ConvertedTotal | null;
  /** Each currency's own total, for a book with no base currency (and for no one else). */
  readonly byCurrency: readonly { currency: string; amount: number }[];
}

/** Net worth on `date`: every account's balance converted at that day's rates, or one total for each currency when there is no base currency. */
export function netWorth(
  rows: readonly AccountRow[],
  baseCurrency: string | null,
  rates: RateSource,
  date: string,
): NetWorth {
  if (baseCurrency === null) {
    const sums = new Map<string, number[]>();
    for (const row of rows)
      sums.set(row.currency, [...(sums.get(row.currency) ?? []), row.balance]);
    return {
      total: null,
      byCurrency: [...sums.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([currency, amounts]) => ({ currency, amount: sumMinor(amounts) })),
    };
  }
  return {
    total: convertedTotal(
      rows.map((row) => ({ amount: row.balance, currency: row.currency, date })),
      baseCurrency,
      rates,
    ),
    byCurrency: [],
  };
}

export interface Overview {
  readonly groups: readonly AccountGroup[];
  readonly netWorth: NetWorth;
  readonly baseCurrency: string | null;
  /** The book's today. */
  readonly today: string;
  /** How many accounts are archived, to offer them. */
  readonly archived: number;
}

/** Loads what the screen needs: the accounts, today's rates for their currencies, and the figures. Reads only the account's own book. */
export async function loadOverview(
  database: Database,
  accountId: string,
  book: Book,
  now: Date = new Date(),
): Promise<Overview> {
  const today = todayIn(book.timeZone, now);
  const [live, archived] = await Promise.all([
    listAccounts(database, accountId, book.id),
    listAccounts(database, accountId, book.id, { archived: true }),
  ]);
  const currencies = [
    ...new Set([
      ...live.map((row) => row.currency),
      ...(book.baseCurrency ? [book.baseCurrency] : []),
    ]),
  ];
  const rates = await loadRates(database, currencies, today, today);
  return {
    groups: groupAccounts(live),
    netWorth: netWorth(live, book.baseCurrency, rates, today),
    baseCurrency: book.baseCurrency,
    today,
    archived: archived.length,
  };
}
