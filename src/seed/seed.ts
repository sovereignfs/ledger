import { sql } from 'drizzle-orm';
import { setBudget } from '../budget/amounts';
import { createCategory, createSubcategory } from '../budget/categories';
import { createIncomeSource } from '../budget/income-sources';
import { addMonths, monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tableNamed } from '../db/tables';
import { storeRates } from '../fx/rates';
import { createAccount } from '../ledger/accounts';
import { balanceOf } from '../ledger/balances';
import { findBook } from '../ledger/books';
import { reconcile } from '../ledger/reconcile';
import { revalue } from '../ledger/revalue';
import { BOOK_TABLES } from '../ledger/tables';
import { createTransaction } from '../ledger/transactions';
import type { TxnInput } from '../ledger/validate';
import { contributeDue } from '../jars/contributions';
import { createJar } from '../jars/jars';
import { createInstalments } from '../recurring/loan';
import { setBudgetSource } from '../recurring/bills';
import {
  type NewRecurring,
  type Template,
  createRecurring,
  postDue,
  postOccurrence,
} from '../recurring/recurring';
import { finishSetup, setupCurrency } from '../setup/setup';
import { seedStates } from './states';

/**
 * A book worth looking at (DESIGN.md §19), for development: **a year deep, in two currencies and a third with no rate**, with an account of every kind, splits, transfers
 * (one between currencies), a refund, a card paid off, money lent to a person, a loan paying itself down, jars with their contributions and a flight paid from one,
 * recurring entries of both modes (a rent that posts itself and an electricity bill that waits to be confirmed, one due today), a bill that budgets its subcategory,
 * revaluations, a reconciled account and a month's budget history, and then the states a screen has besides "everything is fine" (`states.ts`, listed in `docs/seed.md`). Every figure comes from the same code the screens use, through the same write path, so the book
 * obeys what a real one does. **The seed writes to a book that is empty**, and `clearBook` empties one.
 */
export interface SeedSummary {
  readonly accounts: number;
  readonly entries: number;
  readonly recurring: number;
  readonly jars: number;
  readonly months: number;
}

/** A small, repeatable random number, so that two seeds of the same day make the same book. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Empties a book of everything in it but the book itself and its members, in one transaction: what `People.deletePerson` deletes, and not the person. */
export async function clearBook(database: Database, bookId: string): Promise<void> {
  await transaction(database, async (tx) => {
    for (const name of BOOK_TABLES)
      await dbAll(
        tx,
        sql`DELETE FROM ${tableNamed(tx, name)} WHERE book_id = ${bookId} RETURNING book_id`,
      );
    await dbAll(
      tx,
      sql`UPDATE ${tableNamed(tx, 'book')} SET setup_done_at = NULL WHERE id = ${bookId} RETURNING id`,
    );
    return 'cleared';
  });
}

const ok = <T extends { ok: boolean }>(result: T, what: string): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(`${what} was refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
};

export async function seedBook(
  database: Database,
  accountId: string,
  bookId: string,
  now: Date = new Date(),
): Promise<SeedSummary> {
  const nowMs = now.getTime();
  const book = await findBook(database, accountId);
  if (!book || book.id !== bookId) throw new Error('the book is not there');
  const has = await dbGet<{ n: number | string }>(
    database,
    sql`SELECT COUNT(*) AS n FROM ${tableNamed(database, 'money_account')} WHERE book_id = ${bookId}`,
  );
  if (Number(has?.n) > 0)
    throw new Error('the book has accounts already; use --reset to empty it first');

  ok(
    await setupCurrency(database, accountId, bookId, { currency: 'USD', timeZone: 'UTC' }, nowMs),
    'the currency',
  );
  const today = todayIn('UTC', now);
  const thisMonth = monthOf(today);
  const first = addMonths(thisMonth, -12);
  const months = Array.from({ length: 13 }, (_, at) => addMonths(first, at));
  const rand = random(Number(today.replace(/-/g, '')));
  const pick = (low: number, high: number) => Math.round(low + rand() * (high - low));
  /** A day of a month, never past today. */
  const on = (month: string, day: number) => {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    return date > today ? today : date;
  };
  const write = async (input: TxnInput, what: string) =>
    ok(await createTransaction(database, accountId, bookId, input, nowMs), what).id;

  // Rates: the euro against the dollar through the year, on the first of each month. The Swiss franc has none, which is the missing rate.
  for (const [at, month] of months.entries())
    await storeRates(
      database,
      `${month}-01`,
      new Map([['EUR', (0.9 + 0.04 * Math.sin(at / 2)).toFixed(4)]]),
      nowMs,
    );

  // Income sources and categories.
  const salary = ok(
    await createIncomeSource(database, accountId, bookId, { name: 'Salary' }, nowMs),
    'Salary',
  ).id;
  const side = ok(
    await createIncomeSource(
      database,
      accountId,
      bookId,
      { name: 'Side work', kind: 'secondary' },
      nowMs,
    ),
    'Side work',
  ).id;
  const subs = new Map<string, string>();
  const layout: [string, string[]][] = [
    ['Housing', ['Rent', 'Utilities']],
    ['Food', ['Groceries', 'Eating out']],
    ['Transport', ['Fuel', 'Insurance']],
    ['Fun', ['Subscriptions', 'Hobbies']],
    ['Health', ['Pharmacy']],
    ['Travel', ['Flights', 'Hotels']],
  ];
  for (const [category, names] of layout) {
    const id = ok(
      await createCategory(database, accountId, bookId, { name: category }, nowMs),
      category,
    ).id;
    for (const name of names)
      subs.set(
        name,
        ok(await createSubcategory(database, accountId, bookId, id, { name }, nowMs), name).id,
      );
  }
  const sub = (name: string) => subs.get(name) as string;

  // Accounts, each with what was in it a year ago.
  const open = (date: string, amount: number) => ({ amount, date });
  const account = async (
    type:
      | 'bank'
      | 'cash'
      | 'savings'
      | 'deposit'
      | 'investment'
      | 'property'
      | 'credit_card'
      | 'person',
    name: string,
    currency: string,
    amount: number,
    extra: { creditLimit?: number; institution?: string } = {},
  ) =>
    ok(
      await createAccount(
        database,
        accountId,
        bookId,
        { type, name, currency, opening: amount ? open(`${first}-01`, amount) : null, ...extra },
        nowMs,
      ),
      name,
    ).id;
  const checking = await account('bank', 'Checking', 'USD', 420_000, {
    institution: 'Northside Bank',
  });
  const wallet = await account('cash', 'Wallet', 'USD', 15_000);
  const savings = await account('savings', 'Savings', 'USD', 1_500_000, {
    institution: 'Northside Bank',
  });
  await account('deposit', 'Rental deposit', 'USD', 200_000);
  const brokerage = await account('investment', 'Brokerage', 'USD', 2_000_000);
  const flat = await account('property', 'Flat', 'USD', 25_000_000);
  const visa = await account('credit_card', 'Visa', 'USD', 0, { creditLimit: 500_000 });
  const alex = await account('person', 'Alex', 'USD', 0);
  const euros = await account('bank', 'Travel (EUR)', 'EUR', 120_000);
  await account('cash', 'Swiss cash (CHF)', 'CHF', 30_000);
  const loan = ok(
    await createAccount(
      database,
      accountId,
      bookId,
      {
        type: 'loan',
        name: 'Car loan',
        currency: 'USD',
        opening: open(`${first}-01`, -1_000_000),
        loan: {
          lender: 'Northside Bank',
          principal: 1_000_000,
          startDate: `${first}-01`,
          endDate: `${addMonths(first, 60)}-01`,
          instalment: 20_000,
          yearlyRate: '6',
          interestSubcategoryId: null,
        },
      },
      nowMs,
    ),
    'the loan',
  ).id;

  // The budget, from the first month: by hand for every subcategory, which a bill later takes over.
  const budgeted: [string, number][] = [
    ['Rent', 120_000],
    ['Utilities', 20_000],
    ['Groceries', 50_000],
    ['Eating out', 15_000],
    ['Fuel', 12_000],
    ['Insurance', 5_000],
    ['Subscriptions', 2_500],
    ['Hobbies', 8_000],
    ['Pharmacy', 4_000],
    ['Flights', 15_000],
    ['Hotels', 10_000],
  ];
  for (const [name, amount] of budgeted)
    ok(
      await setBudget(
        database,
        accountId,
        bookId,
        { kind: 'subcategory', targetId: sub(name), amount, when: 'this', currentMonth: first },
        nowMs,
      ),
      `the budget of ${name}`,
    );
  ok(
    await setBudget(
      database,
      accountId,
      bookId,
      { kind: 'income', targetId: salary, amount: 450_000, when: 'this', currentMonth: first },
      nowMs,
    ),
    'the salary budget',
  );
  ok(
    await setBudget(
      database,
      accountId,
      bookId,
      { kind: 'income', targetId: side, amount: 30_000, when: 'this', currentMonth: first },
      nowMs,
    ),
    'the side work budget',
  );

  // Recurring entries.
  const expense = (from: string, subcategory: string, amount: number, payee: string): Template => ({
    type: 'expense',
    lines: [
      { account: from, amount: -amount, currency: 'USD' },
      { subcategory, amount, currency: 'USD' },
    ],
    payee,
    note: null,
  });
  const recurring = async (input: NewRecurring) =>
    ok(await createRecurring(database, accountId, bookId, input, nowMs), 'a recurring entry').id;
  const dayOfToday = Math.min(Number(today.slice(8)), 28);
  await recurring({
    template: {
      type: 'income',
      lines: [
        { account: checking, amount: 450_000, currency: 'USD' },
        { incomeSource: salary, amount: -450_000, currency: 'USD' },
      ],
      payee: 'Employer',
      note: null,
    },
    unit: 'month',
    every: 1,
    anchor: `${first}-01`,
    mode: 'auto',
  });
  await recurring({
    template: expense(checking, sub('Rent'), 120_000, 'Landlord'),
    unit: 'month',
    every: 1,
    anchor: `${first}-01`,
    mode: 'auto',
  });
  await recurring({
    template: expense(checking, sub('Utilities'), 6_000, 'Fibre Co'),
    unit: 'month',
    every: 1,
    anchor: `${first}-15`,
    mode: 'auto',
  });
  await recurring({
    template: expense(visa, sub('Subscriptions'), 1_599, 'StreamBox'),
    unit: 'month',
    every: 1,
    anchor: `${first}-05`,
    mode: 'auto',
  });
  await recurring({
    template: expense(checking, sub('Insurance'), 60_000, 'Safe Mutual'),
    unit: 'year',
    every: 1,
    anchor: `${addMonths(thisMonth, -4)}-12`,
    mode: 'auto',
  });
  const electricity = await recurring({
    template: expense(checking, sub('Utilities'), 8_500, 'City Power'),
    unit: 'month',
    every: 1,
    anchor: `${first}-${String(dayOfToday).padStart(2, '0')}`,
    mode: 'confirm',
  });
  ok(
    await createInstalments(
      database,
      accountId,
      bookId,
      loan,
      { from: checking, firstDate: `${addMonths(first, 1)}-01`, mode: 'auto' },
      nowMs,
    ),
    'the instalments',
  );
  if (!(await setBudgetSource(database, accountId, bookId, sub('Insurance'), 'bills', nowMs)))
    throw new Error('the insurance could not be budgeted by its bill');
  // What is due, by the book's own calendar, posts: the salary, the rent, the loan and the rest of a year.
  await postDue(database, now);
  // The electricity bill asks first: each month before this one was confirmed with what it came to, and this month's waits, due today.
  for (const month of months.slice(0, -1)) {
    const date = on(month, dayOfToday);
    const posted = await postOccurrence(database, accountId, bookId, electricity, date, nowMs, {
      expect: date,
      template: expense(checking, sub('Utilities'), pick(6_500, 11_500), 'City Power'),
    });
    if (posted.status !== 'posted') throw new Error(`an electricity bill was ${posted.status}`);
  }

  // The month-by-month life: groceries, eating out, fuel, a split, the card, savings, a refund, side work.
  for (const [at, month] of months.entries()) {
    const spend = (day: number, name: string, amount: number, from: string, payee: string) =>
      write(
        {
          type: 'expense',
          date: on(month, day),
          payee,
          lines: [
            { account: from, amount: -amount, currency: 'USD' },
            { subcategory: sub(name), amount, currency: 'USD' },
          ],
        },
        name,
      );
    for (const day of [3, 10, 17, 24])
      await spend(day, 'Groceries', pick(6_000, 14_000), at % 2 ? visa : checking, 'Corner Market');
    for (const day of [6, 13, 27])
      await spend(day, 'Eating out', pick(1_500, 5_500), day === 13 ? visa : wallet, 'Lunch Place');
    for (const day of [8, 21])
      await spend(day, 'Fuel', pick(4_000, 7_500), checking, 'Petrol Stop');
    if (at % 3 === 0) await spend(19, 'Pharmacy', pick(1_200, 3_800), checking, 'Chemist');
    if (at % 2 === 1) await spend(22, 'Hobbies', pick(2_000, 9_000), visa, 'Craft Shop');
    if (at % 2 === 0)
      await write(
        {
          type: 'expense',
          date: on(month, 15),
          payee: 'Big Store',
          lines: [
            { account: checking, amount: -9_500, currency: 'USD' },
            { subcategory: sub('Groceries'), amount: 7_500, currency: 'USD' },
            { subcategory: sub('Pharmacy'), amount: 2_000, currency: 'USD' },
          ],
        },
        'a split',
      );
    await write(
      {
        type: 'transfer',
        date: on(month, 2),
        lines: [
          { account: checking, amount: -50_000, currency: 'USD' },
          { account: savings, amount: 50_000, currency: 'USD' },
        ],
      },
      'a saving',
    );
    if (at > 0) {
      const pay = pick(30_000, 40_000);
      await write(
        {
          type: 'transfer',
          date: on(month, 28),
          lines: [
            { account: checking, amount: -pay, currency: 'USD' },
            { account: visa, amount: pay, currency: 'USD' },
          ],
        },
        'the card',
      );
    }
    if ([2, 6, 10].includes(at)) {
      const paid = pick(20_000, 45_000);
      await write(
        {
          type: 'income',
          date: on(month, 18),
          payee: 'A client',
          lines: [
            { account: checking, amount: paid, currency: 'USD' },
            { incomeSource: side, amount: -paid, currency: 'USD' },
          ],
        },
        'side work',
      );
    }
  }

  // One of each of the rest: money back, a trip's euros (two amounts and a rate), money lent and part of it paid back.
  await write(
    {
      type: 'expense',
      date: on(addMonths(thisMonth, -2), 12),
      payee: 'Craft Shop',
      lines: [
        { account: visa, amount: 3_500, currency: 'USD' },
        { subcategory: sub('Hobbies'), amount: -3_500, currency: 'USD' },
      ],
    },
    'a refund',
  );
  await write(
    {
      type: 'transfer',
      date: on(addMonths(thisMonth, -5), 9),
      lines: [
        { account: checking, amount: -50_000, currency: 'USD' },
        { account: euros, amount: 46_200, currency: 'EUR' },
      ],
    },
    'a transfer between currencies',
  );
  await write(
    {
      type: 'expense',
      date: on(addMonths(thisMonth, -5), 14),
      payee: 'Harbour Hotel',
      lines: [
        { account: euros, amount: -38_000, currency: 'EUR' },
        { subcategory: sub('Hotels'), amount: 38_000, currency: 'EUR' },
      ],
    },
    'a hotel in euros',
  );
  await write(
    {
      type: 'transfer',
      date: on(addMonths(thisMonth, -3), 7),
      lines: [
        { account: checking, amount: -12_000, currency: 'USD' },
        { account: alex, amount: 12_000, currency: 'USD' },
      ],
    },
    'money lent',
  );
  await write(
    {
      type: 'transfer',
      date: on(addMonths(thisMonth, -1), 7),
      lines: [
        { account: alex, amount: -6_000, currency: 'USD' },
        { account: checking, amount: 6_000, currency: 'USD' },
      ],
    },
    'money paid back',
  );

  // Values: the brokerage each quarter, the flat twice.
  for (const [at, month] of months.entries()) {
    if (at % 3 === 0 && at > 0)
      ok(
        await revalue(
          database,
          accountId,
          bookId,
          brokerage,
          { date: on(month, 1), value: 2_000_000 + at * 90_000 + pick(-40_000, 60_000) },
          nowMs,
        ),
        'a value',
      );
  }
  ok(
    await revalue(
      database,
      accountId,
      bookId,
      flat,
      { date: on(addMonths(thisMonth, -6), 1), value: 25_600_000 },
      nowMs,
    ),
    'the flat',
  );
  ok(
    await revalue(
      database,
      accountId,
      bookId,
      flat,
      { date: on(thisMonth, 1), value: 26_100_000 },
      nowMs,
    ),
    'the flat',
  );

  // Jars: contributions month by month from the month after they were made, then a flight paid from one.
  const jars = [
    ['Travel', 300_000, 15_000],
    ['Emergency fund', 1_000_000, 20_000],
  ] as const;
  const jarIds: string[] = [];
  for (const [name, target, monthly] of jars)
    jarIds.push(
      ok(
        await createJar(
          database,
          accountId,
          bookId,
          { accountId: savings, name, target, monthly },
          first,
          new Date(`${first}-01T00:00:00Z`).getTime(),
        ),
        name,
      ).id,
    );
  for (const month of months.slice(1))
    await contributeDue(
      database,
      new Date(`${month}-02T12:00:00Z`) > now ? now : new Date(`${month}-02T12:00:00Z`),
    );
  await write(
    {
      type: 'expense',
      date: on(addMonths(thisMonth, -2), 20),
      payee: 'SkyWays',
      fromJar: jarIds[0] as string,
      lines: [
        { account: savings, amount: -40_000, currency: 'USD' },
        { subcategory: sub('Flights'), amount: 40_000, currency: 'USD' },
      ],
    },
    'a flight from the Travel jar',
  );

  // The states a screen has besides "everything is fine" (`states.ts`): insights, reviewed months, archived things, overdue bills, jars of every kind, other currencies, other scripts.
  await seedStates({
    database,
    accountId,
    bookId,
    now,
    nowMs,
    today,
    thisMonth,
    first,
    months,
    checking,
    savings,
    visa,
    sub,
    on,
  });

  // Reconciling: the checking account and the savings, to what they hold last month end (which clears what came before), and the wallet, which was short.
  const lastEnd = on(addMonths(thisMonth, -1), 28);
  for (const id of [checking, savings])
    ok(
      await reconcile(
        database,
        accountId,
        bookId,
        id,
        { date: lastEnd, balance: await balanceOf(database, accountId, bookId, id, lastEnd) },
        nowMs,
      ),
      'a reconciliation',
    );
  ok(
    await reconcile(
      database,
      accountId,
      bookId,
      wallet,
      {
        date: lastEnd,
        balance: (await balanceOf(database, accountId, bookId, wallet, lastEnd)) - 1_250,
      },
      nowMs,
    ),
    'the wallet',
  );

  ok(await finishSetup(database, accountId, bookId, nowMs), 'setup');

  const count = async (table: string) =>
    Number(
      (
        await dbGet<{ n: number | string }>(
          database,
          sql`SELECT COUNT(*) AS n FROM ${tableNamed(database, table)} WHERE book_id = ${bookId}`,
        )
      )?.n,
    );
  return {
    accounts: await count('money_account'),
    entries: await count('txn'),
    recurring: await count('recurring'),
    jars: await count('jar'),
    months: months.length,
  };
}
