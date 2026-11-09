import { setBudget } from '../budget/amounts';
import { createCategory, createSubcategory, setCategoryArchived } from '../budget/categories';
import { addMonths } from '../dates';
import type { Database } from '../db/client';
import { storeRates } from '../fx/rates';
import { contributeDue } from '../jars/contributions';
import { createJar, setJarArchived } from '../jars/jars';
import { createAccount, setArchived } from '../ledger/accounts';
import { listPayees, mergePayees, setPayeeArchived } from '../ledger/payees';
import { createTransaction } from '../ledger/transactions';
import type { TxnInput } from '../ledger/validate';
import {
  type NewRecurring,
  type Template,
  createRecurring,
  endRecurring,
  postDue,
  skipOccurrence,
} from '../recurring/recurring';
import { setReviewed } from '../reports/review';

/**
 * **The states a screen has besides "everything is fine"** (DESIGN.md §19), added to the year of realistic data that `seed.ts` makes, so that every feature built so far has something to
 * look at and to test against. Each part says which screen it is for; `docs/seed.md` lists them in one table. Like the rest of the seed it goes through the same code the screens
 * use and writes nothing by hand, so the book obeys what a real one does.
 *
 *  - **Insights:** a subcategory over its budget two completed months running, and an expense three times its usual.
 *  - **Reviewing:** the oldest nine completed months reviewed and the last three not, so Reports has both and Overview a banner.
 *  - **Archived and merged:** a category with history, an account that is closed, a payee archived and one merged into another.
 *  - **Bills:** two that ask first and are overdue, one with an occurrence skipped, one on a rule that is not monthly, and one that has ended.
 *  - **Jars:** one that has reached its target, one whose contribution never fits (Overview says so), and one archived.
 *  - **Money in other shapes:** a currency with no decimals (JPY) and one with three (BHD), with rates; a person you owe.
 *  - **Text:** names in other scripts, with emoji and a long one, and a payee that is markup, which must be shown as text.
 *  - **Budget history:** a raise that began months ago and one that begins next month.
 */
export interface StateContext {
  readonly database: Database;
  readonly accountId: string;
  readonly bookId: string;
  readonly now: Date;
  readonly nowMs: number;
  readonly today: string;
  readonly thisMonth: string;
  /** The first of the 13 months and all of them, the last being this one. */
  readonly first: string;
  readonly months: readonly string[];
  readonly checking: string;
  readonly savings: string;
  readonly visa: string;
  /** A subcategory by name, from the main seed. */
  readonly sub: (name: string) => string;
  /** A day of a month, never past today. */
  readonly on: (month: string, day: number) => string;
}

const ok = <T extends { ok: boolean }>(result: T, what: string): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(`${what} was refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
};

/** `days` before a day, as a day. */
export function daysBefore(day: string, days: number): string {
  return new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)) - days),
  )
    .toISOString()
    .slice(0, 10);
}

export async function seedStates(c: StateContext): Promise<void> {
  const { database, accountId, bookId, nowMs, today, thisMonth, first, months } = c;
  const write = async (input: TxnInput, what: string) =>
    ok(await createTransaction(database, accountId, bookId, input, nowMs), what).id;
  const spend = (date: string, from: string, subcategory: string, amount: number, payee: string) =>
    write(
      {
        type: 'expense',
        date,
        payee,
        lines: [
          { account: from, amount: -amount, currency: 'USD' },
          { subcategory, amount, currency: 'USD' },
        ],
      },
      `${payee} on ${date}`,
    );

  // Budget history: Groceries was raised four months ago, and Eating out will be from next month, so the budget screen's history has something in it.
  ok(
    await setBudget(
      database,
      accountId,
      bookId,
      {
        kind: 'subcategory',
        targetId: c.sub('Groceries'),
        amount: 55_000,
        when: 'this',
        currentMonth: addMonths(thisMonth, -4),
      },
      nowMs,
    ),
    'a raise',
  );
  ok(
    await setBudget(
      database,
      accountId,
      bookId,
      {
        kind: 'subcategory',
        targetId: c.sub('Eating out'),
        amount: 18_000,
        when: 'next',
        currentMonth: thisMonth,
      },
      nowMs,
    ),
    'a raise from next month',
  );

  // Insights: Eating out over its budget of 150.00 in each of the last two completed months, and a garage bill far above what fuel usually costs, today.
  for (const month of [addMonths(thisMonth, -2), addMonths(thisMonth, -1)])
    await spend(c.on(month, 23), c.visa, c.sub('Eating out'), 14_000, 'Birthday Dinner');
  await spend(today, c.checking, c.sub('Fuel'), 45_000, 'Garage');

  // Archived and merged: a category that was used and is put away; an account that was emptied and closed; a payee typed twice, and one nobody pays any more.
  const old = ok(
    await createCategory(database, accountId, bookId, { name: 'Old hobbies' }, nowMs),
    'a category',
  );
  const stamps = ok(
    await createSubcategory(database, accountId, bookId, old.id, { name: 'Stamps' }, nowMs),
    'a subcategory',
  );
  await spend(c.on(months[1] as string, 9), c.checking, stamps.id, 1_200, 'Stamp Dealer');
  if (!(await setCategoryArchived(database, accountId, bookId, 'category', old.id, true)))
    throw new Error('the old category could not be archived');
  const closed = ok(
    await createAccount(
      database,
      accountId,
      bookId,
      {
        type: 'savings',
        name: 'Closed savings',
        currency: 'USD',
        opening: { amount: 80_000, date: `${first}-01` },
      },
      nowMs,
    ),
    'a closed account',
  );
  await write(
    {
      type: 'transfer',
      date: c.on(months[3] as string, 11),
      lines: [
        { account: closed.id, amount: -80_000, currency: 'USD' },
        { account: c.checking, amount: 80_000, currency: 'USD' },
      ],
    },
    'closing an account',
  );
  if (!(await setArchived(database, accountId, bookId, closed.id, true, nowMs)))
    throw new Error('the closed account could not be archived');
  await spend(c.on(months[8] as string, 4), c.checking, c.sub('Groceries'), 4_300, 'Corner Mart');
  await spend(c.on(months[9] as string, 4), c.checking, c.sub('Groceries'), 5_100, 'Corner Mart');
  const named = async (query: string, exact: string) =>
    (await listPayees(database, accountId, bookId, { query })).find((each) => each.name === exact);
  const typo = await named('Corner Mart', 'Corner Mart');
  const real = await named('Corner Market', 'Corner Market');
  if (!typo || !real || !(await mergePayees(database, accountId, bookId, typo.id, real.id)))
    throw new Error('the payees could not be merged');
  const chemist = await named('Chemist', 'Chemist');
  if (!chemist || !(await setPayeeArchived(database, accountId, bookId, chemist.id, true, nowMs)))
    throw new Error('the chemist could not be archived');

  // Bills. Two ask first and are behind (one has an occurrence skipped), a cleaner comes every second week by itself, and a gym membership was ended.
  const bill = (to: string, amount: number, payee: string): Template => ({
    type: 'expense',
    lines: [
      { account: c.checking, amount: -amount, currency: 'USD' },
      { subcategory: to, amount, currency: 'USD' },
    ],
    payee,
    note: null,
  });
  const repeating = async (input: NewRecurring) =>
    ok(await createRecurring(database, accountId, bookId, input, nowMs), 'a bill').id;
  await repeating({
    template: bill(c.sub('Hobbies'), 3_900, 'Climbing Gym'),
    unit: 'month',
    every: 1,
    anchor: daysBefore(today, 70),
    mode: 'confirm',
  });
  const paper = await repeating({
    template: bill(c.sub('Subscriptions'), 1_200, 'Daily Paper'),
    unit: 'month',
    every: 1,
    anchor: daysBefore(today, 40),
    mode: 'confirm',
  });
  if (
    (await skipOccurrence(database, accountId, bookId, paper, daysBefore(today, 40), nowMs)) !==
    'skipped'
  )
    throw new Error('an occurrence could not be skipped');
  await repeating({
    template: bill(c.sub('Utilities'), 7_000, 'Cleaner'),
    unit: 'week',
    every: 2,
    anchor: daysBefore(today, 84),
    mode: 'auto',
  });
  const ended = await repeating({
    template: bill(c.sub('Hobbies'), 2_500, 'Old Gym'),
    unit: 'month',
    every: 1,
    anchor: `${addMonths(first, 1)}-20`,
    mode: 'auto',
  });
  await postDue(database, c.now);
  if (!(await endRecurring(database, accountId, bookId, ended, nowMs)))
    throw new Error('a bill could not be ended');

  // Jars. The laptop has just reached its target with this month's contribution; the holiday pot sits in an account too small for its contribution, so each month's is skipped; the old plan is put away.
  const pot = ok(
    await createAccount(
      database,
      accountId,
      bookId,
      {
        type: 'savings',
        name: 'Holiday pot',
        currency: 'USD',
        opening: { amount: 5_000, date: `${first}-01` },
      },
      nowMs,
    ),
    'the holiday pot',
  );
  const at = new Date(`${first}-01T00:00:00Z`).getTime();
  ok(
    await createJar(
      database,
      accountId,
      bookId,
      { accountId: c.savings, name: 'Laptop', target: 120_000, monthly: 10_000 },
      first,
      at,
    ),
    'a jar',
  );
  ok(
    await createJar(
      database,
      accountId,
      bookId,
      { accountId: pot.id, name: 'Holiday', target: 100_000, monthly: 10_000 },
      first,
      at,
    ),
    'a jar that does not fit',
  );
  const plan = ok(
    await createJar(
      database,
      accountId,
      bookId,
      { accountId: c.savings, name: 'Old plan', target: 50_000, monthly: null },
      first,
      at,
    ),
    'a jar to put away',
  );
  ok(await setJarArchived(database, accountId, bookId, plan.id, true, nowMs), 'an archived jar');
  for (const month of months.slice(1)) {
    const day = new Date(`${month}-02T12:00:00Z`);
    await contributeDue(database, day > c.now ? c.now : day);
  }

  // Money in other shapes: yen have no decimals and dinars three, each with a rate; a person who lent you money, so that you owe them.
  for (const [index, month] of months.entries())
    await storeRates(
      database,
      `${month}-01`,
      new Map([
        ['JPY', (148 + (index % 5)).toFixed(2)],
        ['BHD', '0.3760'],
      ]),
      nowMs,
    );
  const yen = ok(
    await createAccount(
      database,
      accountId,
      bookId,
      {
        type: 'bank',
        name: 'Japan trip (JPY)',
        currency: 'JPY',
        opening: { amount: 300_000, date: `${addMonths(thisMonth, -3)}-01` },
      },
      nowMs,
    ),
    'a yen account',
  );
  ok(
    await createAccount(
      database,
      accountId,
      bookId,
      {
        type: 'bank',
        name: 'Gulf (BHD)',
        currency: 'BHD',
        opening: { amount: 150_000, date: `${addMonths(thisMonth, -3)}-01` },
      },
      nowMs,
    ),
    'a dinar account',
  );
  const trips = ok(
    await createCategory(database, accountId, bookId, { name: 'Trips' }, nowMs),
    'Trips',
  );
  const tokyo = ok(
    await createSubcategory(database, accountId, bookId, trips.id, { name: 'Tokyo' }, nowMs),
    'Tokyo',
  );
  await write(
    {
      type: 'expense',
      date: c.on(addMonths(thisMonth, -2), 14),
      payee: 'Ramen Ichiban',
      lines: [
        { account: yen.id, amount: -4_800, currency: 'JPY' },
        { subcategory: tokyo.id, amount: 4_800, currency: 'JPY' },
      ],
    },
    'ramen',
  );
  const sam = ok(
    await createAccount(
      database,
      accountId,
      bookId,
      { type: 'person', name: 'Sam', currency: 'USD', opening: null },
      nowMs,
    ),
    'a person you owe',
  );
  await write(
    {
      type: 'transfer',
      date: c.on(months[8] as string, 5),
      lines: [
        { account: sam.id, amount: -8_000, currency: 'USD' },
        { account: c.checking, amount: 8_000, currency: 'USD' },
      ],
    },
    'money borrowed',
  );

  // Text: other scripts, emoji, a long name, and a payee that is markup and has to come out as text.
  await write(
    {
      type: 'expense',
      date: c.on(addMonths(thisMonth, -1), 3),
      payee: 'مقهى الحي ☕',
      note: 'قهوة مع الأصدقاء — café crème, 日本語のメモ, Ñandú, 🍰',
      lines: [
        { account: c.checking, amount: -1_850, currency: 'USD' },
        { subcategory: c.sub('Eating out'), amount: 1_850, currency: 'USD' },
      ],
    },
    'a payee in Arabic',
  );
  await write(
    {
      type: 'expense',
      date: c.on(addMonths(thisMonth, -1), 4),
      payee: '<b>Bold</b> & <script>alert(1)</script>',
      note: '"><img src=x onerror=alert(1)>',
      lines: [
        { account: c.checking, amount: -900, currency: 'USD' },
        { subcategory: c.sub('Hobbies'), amount: 900, currency: 'USD' },
      ],
    },
    'a payee that is markup',
  );
  ok(
    await createAccount(
      database,
      accountId,
      bookId,
      {
        type: 'bank',
        name: 'Конто 🏦 with a rather long name that has to wrap somewhere',
        currency: 'USD',
        opening: { amount: 12_345, date: `${first}-01` },
      },
      nowMs,
    ),
    'a long name',
  );

  // Reviewing: the oldest nine completed months are reviewed, the last three are not.
  for (const month of months.slice(0, 9))
    ok(
      await setReviewed(database, accountId, bookId, month, true, today, nowMs),
      `reviewing ${month}`,
    );
}
