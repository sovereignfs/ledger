import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { loadRates } from '../fx/rates';
import { balancesOf } from '../ledger/balances';
import type { Book } from '../ledger/books';
import { type ConvertedTotal, convertedTotal } from '../money/convert';
import { formatMoney } from '../money/text';
import { accountFigures, earmarkedByAccount } from './jars';
import { type SavingRow, loadSaving } from './saving';

/**
 * What Overview says about jars (DESIGN.md §10.2, §14.3): the total in jars, and the notes that need a person: **a contribution skipped** because it did not fit in what
 * was free, and **an account over-earmarked** by spending, which asks which jar to release. The notes are built **purely** from the jars and the accounts' figures,
 * so the screen and the tests share them; the page links each to the account, where the jars are.
 */
export interface JarNote {
  readonly kind: 'skipped' | 'over';
  readonly text: string;
  readonly href: string;
}

export function jarNotes(input: {
  jars: readonly SavingRow[];
  /** The jars whose contribution for the month was skipped. */
  skipped: ReadonlySet<string>;
  /** Each account that has jars, with what it holds and what is in them. */
  accounts: readonly {
    id: string;
    name: string;
    currency: string;
    balance: number;
    inJars: number;
  }[];
  money: (amount: number, currency: string) => string;
}): JarNote[] {
  const notes: JarNote[] = [];
  for (const jar of input.jars)
    if (input.skipped.has(jar.id) && jar.monthly)
      notes.push({
        kind: 'skipped',
        text: `${jar.name}: this month's ${input.money(jar.monthly, jar.currency)} was not set aside, because there was not enough free in ${jar.accountName}.`,
        href: `/accounts/${jar.accountId}`,
      });
  for (const account of input.accounts) {
    const { free, overEarmarked } = accountFigures(account.balance, account.inJars);
    if (overEarmarked)
      notes.push({
        kind: 'over',
        text: `${account.name} holds ${input.money(-free, account.currency)} less than its jars. Release some from a jar.`,
        href: `/accounts/${account.id}`,
      });
  }
  return notes;
}

export interface JarsOverview {
  readonly count: number;
  /** What the jars hold, in the base currency, with what was left out for want of a rate; `null` while the book has no base currency. */
  readonly total: ConvertedTotal | null;
  readonly notes: readonly JarNote[];
}

const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export async function loadJarsOverview(
  database: Database,
  accountId: string,
  book: Book,
  now: Date = new Date(),
): Promise<JarsOverview> {
  const s = schema(database);
  const today = todayIn(book.timeZone, now);
  const month = monthOf(today);
  const [jars, earmarked, balances, skippedRows] = await Promise.all([
    loadSaving(database, accountId, book.id, month),
    earmarkedByAccount(database, accountId, book.id),
    balancesOf(database, accountId, book.id),
    dbAll<{ jarId: string }>(
      database,
      sql`SELECT v.jar_id AS "jarId" FROM ${s.jarMovement} v
           WHERE v.book_id = ${book.id} AND ${inBook(database, sql`v.book_id`, accountId)}
             AND v.kind = 'contribution' AND v.month = ${month} AND v.amount = 0`,
    ),
  ]);
  const accounts = [...new Map(jars.map((jar) => [jar.accountId, jar])).values()].map((jar) => ({
    id: jar.accountId,
    name: jar.accountName,
    currency: jar.currency,
    balance: balances.get(jar.accountId) ?? 0,
    inJars: earmarked.get(jar.accountId) ?? 0,
  }));
  const rates = book.baseCurrency
    ? await loadRates(
        database,
        [book.baseCurrency, ...jars.map((jar) => jar.currency)],
        today,
        today,
      )
    : undefined;
  const total =
    book.baseCurrency && rates
      ? convertedTotal(
          jars.map((jar) => ({ amount: jar.balance, currency: jar.currency, date: today })),
          book.baseCurrency,
          rates,
        )
      : null;
  return {
    count: jars.length,
    total,
    notes: jarNotes({
      jars,
      skipped: new Set(skippedRows.map((row) => row.jarId)),
      accounts,
      money: (amount, currency) => formatMoney(amount, currency, book.locale ?? undefined),
    }),
  };
}
