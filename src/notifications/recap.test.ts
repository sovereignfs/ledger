import { createSovereign } from '@sovereignfs/sdk';
import { createFakeCore } from '@sovereignfs/sdk/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { setBudget } from '../budget/amounts';
import { createCategory, createSubcategory } from '../budget/categories';
import { dbGet } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { updateBook } from '../ledger/book-settings';
import { type Book, ensureBook, findBook } from '../ledger/books';
import { seedIncomeSource } from '../ledger/testing';
import { createTransaction } from '../ledger/transactions';
import { MemoryMailer } from '../mail/memory';
import type { MonthReport } from '../reports/month';
import type { Insight } from '../insights/rules';
import { coreChannel, coreEmailChannel, emailChannel } from './channels';
import { notifyDue } from './job';
import { figuresOf, hasSomethingToSay, monthLabel, recapMonthFor, recapNotice } from './recap';
import { setupCurrency } from '../setup/setup';

const { leg } = testTarget();
const at = (iso: string) => new Date(iso);

const total = (amount: number, currency = 'USD') => ({
  currency,
  amount,
  included: 1,
  notIncluded: [],
});
const category = (name: string, currency: string, budgeted: number, spent: number) => ({
  id: name,
  name,
  currency,
  budgeted,
  spent,
  over: Math.max(0, spent - budgeted),
  rows: [],
});
// A report with only the parts a recap reads: the rest is the report's own and is tested with it.
const report = (over: Partial<MonthReport> = {}): MonthReport =>
  ({
    month: '2026-10',
    base: 'USD',
    income: { received: total(300_000), budgeted: total(280_000) },
    budget: { spent: total(250_000), budgeted: total(240_000) },
    categories: [],
    savings: { projected: 40_000, actual: 50_000, afterJars: 30_000 },
    notIncluded: [],
    ...over,
  }) as unknown as MonthReport;

describe('the recap’s figures and words (pure)', () => {
  it('ranks the three categories furthest over by how much of their budget the excess is, across currencies, and leaves out those not over', () => {
    const figures = figuresOf(
      report({
        categories: [
          category('Food', 'USD', 10_000, 12_000), // 20%
          category('Fun', 'EUR', 5_000, 9_000), // 80%
          category('Fuel', 'JPY', 20_000, 25_000), // 25%
          category('Rent', 'USD', 100_000, 160_000), // 60%
          category('Calm', 'USD', 10_000, 4_000),
          category('Unbudgeted', 'USD', 0, 900),
        ],
      }),
      [],
      'en',
    );
    expect(figures.over.map((each) => each.name)).toEqual(['Fun', 'Rent', 'Fuel']);
  });

  it('says it in the book’s currency and the words of the app, with the month, a link to its report and what was left out', () => {
    const notice = recapNotice(
      figuresOf(
        report({
          categories: [category('Food', 'USD', 10_000, 12_500)],
          notIncluded: ['Spent: 2 amounts in XYZ not included'],
        }),
        [
          {
            id: 'i',
            kind: 'over_budget_again',
            text: 'Food is over its budget again',
            href: '/budget',
          } as Insight,
        ],
        'en',
      ),
    );
    expect(notice.title).toBe('Your October 2026 recap');
    expect(notice.path).toBe('/reports?month=2026-10');
    expect(notice.body).toBe('Spent $2,500.00 of $2,400.00 budgeted; saved $500.00.');
    const text = notice.email?.text ?? '';
    expect(notice.email?.subject).toBe('Your budget for October 2026');
    expect(text).toContain('Income received: $3,000.00');
    expect(text).toContain('Saved after what went into jars: $300.00');
    expect(text).toContain('Not included: Spent: 2 amounts in XYZ not included');
    expect(text).toContain('- Food: $25.00 over its $100.00 budgeted');
    expect(text).toContain('- Food is over its budget again');
    expect(text).not.toMatch(/predicted|actual|client|plugin/i);
  });

  it('has nothing to say with no base currency or a month with nothing in it, and a bad locale reads in English', () => {
    expect(hasSomethingToSay(figuresOf(report(), [], 'en'))).toBe(true);
    expect(hasSomethingToSay(figuresOf(report({ base: null }), [], 'en'))).toBe(false);
    const empty = report({
      income: { received: total(0), budgeted: null },
      budget: { spent: { ...total(0), included: 0 }, budgeted: null },
    } as unknown as Partial<MonthReport>);
    expect(
      hasSomethingToSay(
        figuresOf(
          {
            ...empty,
            income: { received: { ...total(0), included: 0 }, budgeted: null },
          } as unknown as MonthReport,
          [],
          'en',
        ),
      ),
    ).toBe(false);
    expect(monthLabel('2026-10', 'not a locale!!')).toBe('October 2026');
    expect(monthLabel('2026-10', null)).toBe('October 2026');
  });

  it('is due in the first seven days of the book’s own month, for the month before, across a year', () => {
    expect(recapMonthFor('UTC', at('2026-11-01T00:30:00Z'))).toBe('2026-10');
    expect(recapMonthFor('UTC', at('2026-11-07T23:00:00Z'))).toBe('2026-10');
    expect(recapMonthFor('UTC', at('2026-11-08T00:00:00Z'))).toBeNull();
    expect(recapMonthFor('UTC', at('2027-01-03T12:00:00Z'))).toBe('2026-12');
    // Still the 31st in Los Angeles an hour after midnight UTC on the 1st, so not yet; already the 1st in Kiritimati the day before.
    expect(recapMonthFor('America/Los_Angeles', at('2026-11-01T01:00:00Z'))).toBeNull();
    expect(recapMonthFor('Pacific/Kiritimati', at('2026-10-31T12:00:00Z'))).toBe('2026-10');
  });
});

const SUB = 'sub-ada';
let t: TwoAccounts;
let book: Book;
let bank: string;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  book = (await findBook(t.database, t.ada.id)) as Book;
  await setupCurrency(t.database, t.ada.id, book.id, { currency: 'USD', timeZone: 'UTC' }, 1);
  book = (await findBook(t.database, t.ada.id)) as Book;
  const okay = <T extends { ok: boolean }>(result: T) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  };
  bank = okay(
    await createAccount(t.database, t.ada.id, book.id, {
      type: 'bank',
      name: 'Bank',
      currency: 'USD',
      opening: { amount: 10_000_000, date: '2026-01-01' },
    }),
  ).id;
  const home = okay(await createCategory(t.database, t.ada.id, book.id, { name: 'Home' })).id;
  const food = okay(
    await createSubcategory(t.database, t.ada.id, book.id, home, { name: 'Groceries' }),
  ).id;
  await setBudget(t.database, t.ada.id, book.id, {
    kind: 'subcategory',
    targetId: food,
    amount: 10_000,
    when: 'this',
    currentMonth: '2026-01',
  });
  const pay = await seedIncomeSource(t.database, book.id);
  okay(
    await createTransaction(t.database, t.ada.id, book.id, {
      type: 'expense',
      date: '2026-10-10',
      lines: [
        { account: bank, amount: -12_500, currency: 'USD' },
        { subcategory: food, amount: 12_500, currency: 'USD' },
      ],
    }),
  );
  okay(
    await createTransaction(t.database, t.ada.id, book.id, {
      type: 'income',
      date: '2026-10-01',
      lines: [
        { account: bank, amount: 300_000, currency: 'USD' },
        { incomeSource: pay, amount: -300_000, currency: 'USD' },
      ],
    }),
  );
}, 120_000);
afterAll(async () => t.close());

function core() {
  const fake = createFakeCore({
    api: { versions: ['v1'], capabilities: ['directory', 'notifications', 'email', 'activity'] },
  });
  fake.addPerson({ sub: SUB, name: 'Ada' });
  const sovereign = createSovereign({
    appUrl: 'https://ledger.example.com',
    coreUrl: fake.url,
    clientId: fake.credentials.clientId,
    clientSecret: fake.credentials.clientSecret,
    fetch: fake.fetch,
  });
  const deps = {
    sovereign: sovereign.app,
    subOf: async (accountId: string) => (accountId === t.ada.id ? SUB : undefined),
    absolute: (path: string) => `https://ledger.example.com${path}`,
    now: Date.now,
  };
  return {
    fake,
    channels: [coreChannel(deps), coreEmailChannel({ ...deps, enabled: async () => true })],
  };
}
const marks = async (kind: string) =>
  Number(
    (
      await dbGet<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'book_job_mark')} WHERE book_id = ${book.id} AND kind = ${kind}`,
      )
    )?.n,
  );
/** Forgets that a recap was sent, so that a test can send it again. */
const forget = async () =>
  void (await dbGet(
    t.database,
    sql`DELETE FROM ${tableNamed(t.database, 'book_job_mark')} WHERE book_id = ${book.id} AND kind = 'recap' RETURNING kind`,
  ));
const recaps = (fake: ReturnType<typeof core>['fake']) =>
  fake.notificationsSent.filter((each) => each.title.includes('recap'));

describe(`the recap job (${leg})`, () => {
  it('sends last month once, by the bell and by email, to the owner, whoever runs the job and however often, and logs none of its figures', async () => {
    const { fake, channels } = core();
    const lines: string[] = [];
    const now = at('2026-11-01T08:00:00Z');
    await Promise.all([
      notifyDue(t.database, channels, now, (l) => lines.push(l)),
      notifyDue(t.database, channels, now, (l) => lines.push(l)),
    ]);
    await notifyDue(t.database, channels, at('2026-11-01T09:00:00Z'), (l) => lines.push(l));
    await notifyDue(t.database, channels, at('2026-11-03T09:00:00Z'), (l) => lines.push(l));
    expect(recaps(fake)).toHaveLength(1);
    const bell = recaps(fake)[0];
    expect(bell?.to).toBe(SUB);
    expect(bell?.title).toBe('Your October 2026 recap');
    expect(bell?.body).toBe('Spent $125.00 of $100.00 budgeted; saved $2,875.00.');
    expect(bell?.url).toBe('https://ledger.example.com/reports?month=2026-10');
    expect(fake.emailsSent).toHaveLength(1);
    expect(fake.emailsSent[0]?.subject).toBe('Your budget for October 2026');
    expect(fake.emailsSent[0]?.body).toContain('Home: $25.00 over its $100.00 budgeted');
    expect(await marks('recap')).toBe(1);
    expect(lines.join('\n')).not.toMatch(/125|2,875|Home|Ada/);
  });

  it('is not sent after the first week, for a month with nothing in it, or with no channel, and claims nothing then', async () => {
    const before = await marks('recap');
    const { fake, channels } = core();
    await notifyDue(t.database, channels, at('2026-12-09T09:00:00Z'));
    // 2026-08 has nothing in it: the recap sent in the first week of September is nothing.
    await notifyDue(t.database, channels, at('2026-09-02T09:00:00Z'));
    expect(recaps(fake)).toEqual([]);
    await notifyDue(t.database, [], at('2026-12-02T09:00:00Z'));
    expect(await marks('recap')).toBe(before);
  });

  it('is not sent with the recap off, and is when it is turned on in the same first week; another person’s book is untouched', async () => {
    await forget();
    await updateBook(t.database, t.ada.id, book.id, { recap: false });
    const { fake, channels } = core();
    const now = at('2026-11-02T09:00:00Z');
    await notifyDue(t.database, channels, now);
    expect(recaps(fake)).toEqual([]);
    expect(await marks('recap')).toBe(0);
    await updateBook(t.database, t.ada.id, book.id, { recap: true });
    await notifyDue(t.database, channels, now);
    expect(recaps(fake)).toHaveLength(1);
    expect(await marks('recap')).toBe(1);
    const graces = (await findBook(t.database, t.grace.id)) as Book;
    const theirs = Number(
      (
        await dbGet<{ n: number | string }>(
          t.database,
          sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'book_job_mark')} WHERE book_id = ${graces.id}`,
        )
      )?.n,
    );
    expect(theirs).toBe(0);
  });

  it('goes by the app’s own mail where there is no core, to the person’s address, once, with the link to turn it off', async () => {
    await forget();
    const mailer = new MemoryMailer();
    const channel = emailChannel({
      mailer,
      app: 'Ledger',
      addressOf: async (accountId) => (accountId === t.ada.id ? 'ada@example.com' : undefined),
      enabled: async () => true,
      settingsUrl: 'https://ledger.example.com/account?section=notifications',
      absolute: (path) => `https://ledger.example.com${path}`,
    });
    await notifyDue(t.database, [channel], at('2026-11-01T09:00:00Z'));
    await notifyDue(t.database, [channel], at('2026-11-01T10:00:00Z'));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('ada@example.com');
    expect(mailer.sent[0]?.subject).toBe('Your budget for October 2026');
    expect(mailer.sent[0]?.text).toContain(
      'https://ledger.example.com/account?section=notifications',
    );
  });
});
