import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { loadBudget } from '../budget/screen';
import { loadIncome } from '../budget/income';
import { loadOverview } from '../accounts/overview';
import { addMonths, monthOf } from '../dates';
import { dbGet } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { listAccounts } from '../ledger/accounts';
import { findBook, type Book } from '../ledger/books';
import { listEntries } from '../ledger/entry-list';
import { findViolations } from '../ledger/invariants';
import { loadJarsOverview } from '../jars/notes';
import { loadOverviewPage } from '../overview/overview';
import { listRecurring, listUpcoming } from '../recurring/recurring';
import { loadInsights } from '../insights/load';
import { loadReviewBanner, reviewedMonths } from '../reports/review';
import { clearBook, seedBook } from './seed';

/**
 * The development seed (DESIGN.md §19) on a real book on every database: it makes a book a year deep that **obeys what a real one does** (the invariants hold),
 * **every screen's own loader reads it**, what the design says it holds is there, it refuses a book that has accounts, and `clearBook` empties it for another.
 */
const { leg } = testTarget();
const NOW = new Date('2026-11-09T12:00:00Z');

let t: TwoAccounts;
let book: Book;
beforeAll(async () => {
  t = await twoAccounts();
  const { ensureBook } = await import('../ledger/books');
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  book = (await findBook(t.database, t.ada.id)) as Book;
}, 60_000);
afterAll(async () => t.close());

const count = async (table: string, bookId: string) =>
  Number(
    (
      await dbGet<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, table)} WHERE book_id = ${bookId}`,
      )
    )?.n,
  );

describe(`the development seed (${leg})`, () => {
  it('makes a book a year deep that the invariants hold for, and every screen reads', async () => {
    const summary = await seedBook(t.database, t.ada.id, book.id, NOW);
    expect(summary).toMatchObject({ accounts: 17, jars: 5, recurring: 11, months: 13 });
    expect(summary.entries).toBeGreaterThan(250);
    expect(await findViolations(t.database, book.id)).toEqual([]);
    const fresh = (await findBook(t.database, t.ada.id)) as Book;
    expect(fresh).toMatchObject({ baseCurrency: 'USD' });
    expect(fresh.setupDoneAt).not.toBeNull();

    // Every screen's own loader reads it.
    const overview = await loadOverviewPage(t.database, t.ada.id, fresh, NOW);
    expect(overview.hasAccounts).toBe(true);
    // The bills that ask first: today's, and two that are behind (the paper's first occurrence was skipped, so one of its is left).
    expect(new Set(overview.upcoming.map((u) => u.template.payee))).toEqual(
      new Set(['City Power', 'Climbing Gym', 'Daily Paper']),
    );
    expect(overview.jars.count).toBe(4);
    expect(overview.thisMonth.received?.amount).toBeGreaterThan(0);
    for (const month of [monthOf('2025-11-15'), '2026-03', '2026-11']) {
      const budget = await loadBudget(t.database, t.ada.id, fresh, month, NOW);
      expect(budget.groups.flatMap((g) => g.rows).length).toBeGreaterThan(5);
      expect((await loadIncome(t.database, t.ada.id, fresh, month, NOW)).received).not.toBeNull();
    }
    const accounts = await loadOverview(t.database, t.ada.id, fresh, NOW);
    expect(accounts.netWorth.total).not.toBeNull();
    const page = await listEntries(t.database, t.ada.id, fresh.id, {}, undefined, 50);
    expect(page.entries.length).toBe(50);
    expect(page.next).toBeDefined();
    expect((await listRecurring(t.database, t.ada.id, fresh.id)).length).toBe(11);
    expect(
      (await loadJarsOverview(t.database, t.ada.id, fresh, NOW)).total?.amount,
    ).toBeGreaterThan(0);
  }, 180_000);

  it('holds what the design says: every kind of account, a loan paid down by its instalments, jars with contributions and a flight, a missing rate, a bill budgeting', async () => {
    const accounts = await listAccounts(t.database, t.ada.id, book.id);
    expect(new Set(accounts.map((a) => a.type))).toEqual(
      new Set([
        'bank',
        'cash',
        'savings',
        'deposit',
        'investment',
        'property',
        'credit_card',
        'loan',
        'person',
      ]),
    );
    expect(new Set(accounts.map((a) => a.currency))).toEqual(
      new Set(['USD', 'EUR', 'CHF', 'JPY', 'BHD']),
    );
    const loan = accounts.find((a) => a.type === 'loan');
    expect(loan?.balance).toBeGreaterThan(-1_000_000);
    expect(loan?.balance).toBeLessThan(-700_000);
    const fresh = (await findBook(t.database, t.ada.id)) as Book;
    const overview = await loadOverview(t.database, t.ada.id, fresh, NOW);
    // The Swiss franc has no rate: said, and not counted as nothing.
    expect(JSON.stringify(overview.netWorth.total?.notIncluded)).toContain('CHF');
    // Rent was posted every month of the year, by itself.
    const rent = await dbGet<{ n: number | string }>(
      t.database,
      sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'txn')} t JOIN ${tableNamed(t.database, 'recurring')} r ON r.id = t.recurring_id AND r.book_id = t.book_id
           WHERE t.book_id = ${book.id} AND r.mode = 'auto' AND t.type = 'expense' AND r.anchor_date = ${`${addMonths('2026-11', -12)}-01`} AND r.unit = 'month' AND t.date LIKE '%-01'`,
    );
    expect(Number(rent?.n)).toBeGreaterThanOrEqual(12);
    // Contributions were made each month, and the flight came out of the Travel jar.
    const movements = await dbGet<{ contributions: number | string; spends: number | string }>(
      t.database,
      sql`SELECT SUM(CASE WHEN kind = 'contribution' AND amount > 0 THEN 1 ELSE 0 END) AS contributions, SUM(CASE WHEN kind = 'spend' THEN 1 ELSE 0 END) AS spends
            FROM ${tableNamed(t.database, 'jar_movement')} WHERE book_id = ${book.id}`,
    );
    expect(Number(movements?.contributions)).toBeGreaterThanOrEqual(20);
    expect(Number(movements?.spends)).toBe(1);
    const insurance = await dbGet<{ source: string }>(
      t.database,
      sql`SELECT budget_source AS source FROM ${tableNamed(t.database, 'subcategory')} WHERE book_id = ${book.id} AND name = 'Insurance'`,
    );
    expect(insurance?.source).toBe('bills');
    expect(
      (await listUpcoming(t.database, t.ada.id, book.id, 'UTC', NOW)).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('has a state for every screen besides the fine one: insights, reviewed months, archived and merged things, bills behind, jars of every kind, other currencies and other scripts', async () => {
    const fresh = (await findBook(t.database, t.ada.id)) as Book;
    const one = async <T>(query: ReturnType<typeof sql>) =>
      (await dbGet<T>(t.database, query)) as T;
    const named = (table: string) => tableNamed(t.database, table);

    // Insights: Eating out over budget two completed months running, and a garage bill far above fuel's usual.
    const kinds = (await loadInsights(t.database, t.ada.id, fresh, NOW, { limit: 10 })).map(
      (i) => i.kind,
    );
    expect(kinds).toContain('over_budget_again');
    expect(kinds).toContain('unusually_large');

    // Reviewing: nine months reviewed and the last three not, and Overview's banner names the latest of those.
    expect((await reviewedMonths(t.database, t.ada.id, book.id)).size).toBe(9);
    expect(await loadReviewBanner(t.database, t.ada.id, fresh, NOW)).toBe('2026-10');

    // Archived and merged: a category with history, a closed account, an archived payee and a jar; a payee typed twice is one.
    for (const [table, where] of [
      ['category', "name = 'Old hobbies'"],
      ['money_account', "name = 'Closed savings'"],
      ['payee', "name = 'Chemist'"],
      ['jar', "name = 'Old plan'"],
    ] as const)
      expect(
        Number(
          (
            await one<{ n: number | string }>(
              sql`SELECT COUNT(*) AS n FROM ${named(table)} WHERE book_id = ${book.id} AND archived_at IS NOT NULL AND ${sql.raw(where)}`,
            )
          ).n,
        ),
        table,
      ).toBe(1);
    expect(
      Number(
        (
          await one<{ n: number | string }>(
            sql`SELECT COUNT(*) AS n FROM ${named('payee')} WHERE book_id = ${book.id} AND name = 'Corner Mart'`,
          )
        ).n,
      ),
    ).toBe(0);
    const market = await one<{ n: number | string }>(
      sql`SELECT COUNT(*) AS n FROM ${named('txn')} t JOIN ${named('payee')} p ON p.id = t.payee_id AND p.book_id = t.book_id WHERE t.book_id = ${book.id} AND p.name = 'Corner Market' AND t.date IN ('2026-07-04', '2026-08-04')`,
    );
    expect(Number(market.n)).toBe(2);

    // Bills: one skipped, one on a rule that is not monthly, one ended.
    expect(
      Number(
        (
          await one<{ n: number | string }>(
            sql`SELECT COUNT(*) AS n FROM ${named('recurring_skip')} WHERE book_id = ${book.id}`,
          )
        ).n,
      ),
    ).toBe(1);
    const rules = await listRecurring(t.database, t.ada.id, fresh.id);
    expect(rules.filter((r) => r.endedAt !== null).map((r) => r.template.payee)).toEqual([
      'Old Gym',
    ]);
    expect(rules.some((r) => r.rule.unit === 'week' && r.rule.every === 2)).toBe(true);

    // Jars: the laptop has reached its target of 120,000, the holiday jar's contribution never fits and Overview says so.
    const moved = async (name: string) =>
      Number(
        (
          await one<{ n: number | string | null }>(
            sql`SELECT COALESCE(SUM(v.amount), 0) AS n FROM ${named('jar_movement')} v JOIN ${named('jar')} j ON j.id = v.jar_id AND j.book_id = v.book_id WHERE v.book_id = ${book.id} AND j.name = ${name}`,
          )
        ).n,
      );
    expect(await moved('Laptop')).toBe(120_000);
    expect(await moved('Holiday')).toBe(0);
    expect((await loadJarsOverview(t.database, t.ada.id, fresh, NOW)).notes.length).toBeGreaterThan(
      0,
    );

    // Other currencies: yen without decimals, dinars with three, and a person you owe.
    const accounts = await listAccounts(t.database, t.ada.id, book.id);
    const balance = (name: string) => accounts.find((a) => a.name === name)?.balance;
    expect(balance('Japan trip (JPY)')).toBe(300_000 - 4_800);
    expect(balance('Gulf (BHD)')).toBe(150_000);
    expect(balance('Sam')).toBe(-8_000);
    expect(accounts.some((a) => a.name.startsWith('Конто 🏦'))).toBe(true);

    // Text: markup is kept as the text it is, here as a payee; showing it as text is the screens' job, tried in the browser tests.
    expect(
      Number(
        (
          await one<{ n: number | string }>(
            sql`SELECT COUNT(*) AS n FROM ${named('payee')} WHERE book_id = ${book.id} AND name LIKE '%<script>%'`,
          )
        ).n,
      ),
    ).toBe(1);

    // Budget history: Groceries was raised four months ago and Eating out is raised from next month.
    const groceries = async (month: string) =>
      (await loadBudget(t.database, t.ada.id, fresh, month, NOW)).groups
        .flatMap((g) => g.rows)
        .find((r) => r.subcategory.name === 'Groceries')?.budgeted;
    expect(await groceries('2026-06')).toBe(50_000);
    expect(await groceries('2026-07')).toBe(55_000);
    const eating = async (month: string) =>
      (await loadBudget(t.database, t.ada.id, fresh, month, NOW)).groups
        .flatMap((g) => g.rows)
        .find((r) => r.subcategory.name === 'Eating out')?.budgeted;
    expect(await eating('2026-11')).toBe(15_000);
    expect(await eating('2026-12')).toBe(18_000);
  });

  it('writes to the book it is given alone, and refuses a book that has accounts', async () => {
    expect(
      await count('money_account', (await findBook(t.database, t.grace.id))?.id as string),
    ).toBe(0);
    await expect(seedBook(t.database, t.ada.id, book.id, NOW)).rejects.toThrow(
      'has accounts already',
    );
    await expect(seedBook(t.database, t.grace.id, book.id, NOW)).rejects.toThrow('not there');
  });

  it('is emptied by clearBook, and seeds again, the same book of the same day', async () => {
    const before = await count('txn', book.id);
    await clearBook(t.database, book.id);
    for (const table of [
      'txn',
      'txn_line',
      'money_account',
      'recurring',
      'jar',
      'jar_movement',
      'category',
      'budget_amount',
    ])
      expect(await count(table, book.id), table).toBe(0);
    // The book itself and the person are kept.
    expect((await findBook(t.database, t.ada.id))?.id).toBe(book.id);
    const again = await seedBook(t.database, t.ada.id, book.id, NOW);
    expect(again.entries).toBe(before);
    expect(await findViolations(t.database, book.id)).toEqual([]);
  }, 180_000);
});
