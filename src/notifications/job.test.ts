import { createSovereign } from '@sovereignfs/sdk';
import { createFakeCore } from '@sovereignfs/sdk/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { setBudget } from '../budget/amounts';
import { createCategory, createSubcategory } from '../budget/categories';
import { dbAll, dbGet } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { type Book, ensureBook, findBook } from '../ledger/books';
import { createTransaction } from '../ledger/transactions';
import { createRecurring } from '../recurring/recurring';
import { setupCurrency } from '../setup/setup';
import { coreChannel } from './channels';
import { claimMark } from './marks';
import { notifyDue } from './job';

const { leg } = testTarget();
const SUB = 'sub-ada';

/** The notices Ledger sends on its own (DESIGN.md §13.4): against the SDK's fake core, each once for its key, claimed in the database before it is sent. */
let t: TwoAccounts;
let book: Book;
let bank: string;
let food: string;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  book = (await findBook(t.database, t.ada.id)) as Book;
  const okay = <T extends { ok: boolean }>(result: T) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  };
  await setupCurrency(t.database, t.ada.id, book.id, { currency: 'USD', timeZone: 'UTC' }, 1);
  book = (await findBook(t.database, t.ada.id)) as Book;
  bank = okay(
    await createAccount(t.database, t.ada.id, book.id, {
      type: 'bank',
      name: 'Bank',
      currency: 'USD',
      opening: { amount: 10_000_000, date: '2026-01-01' },
    }),
  ).id;
  const home = okay(await createCategory(t.database, t.ada.id, book.id, { name: 'Home' })).id;
  food = okay(
    await createSubcategory(t.database, t.ada.id, book.id, home, { name: 'Groceries' }),
  ).id;
  await setBudget(t.database, t.ada.id, book.id, {
    kind: 'subcategory',
    targetId: food,
    amount: 10_000,
    when: 'this',
    currentMonth: '2026-01',
  });
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
  const channel = coreChannel({
    sovereign: sovereign.app,
    subOf: async (accountId) => (accountId === t.ada.id ? SUB : undefined),
    absolute: (path) => `https://ledger.example.com${path}`,
    now: Date.now,
  });
  return { fake, channel };
}
const marks = async () =>
  Number(
    (
      await dbGet<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'book_job_mark')} WHERE book_id = ${book.id}`,
      )
    )?.n,
  );
const at = (iso: string) => new Date(iso);

describe(`claiming a mark (${leg})`, () => {
  it('is made once for a book, a kind and a mark, whoever asks again, and never for a book that is not the caller’s', async () => {
    expect(await claimMark(t.database, t.ada.id, book.id, 'recap', '2020-01', 1)).toBe(true);
    expect(await claimMark(t.database, t.ada.id, book.id, 'recap', '2020-01', 2)).toBe(false);
    const both = await Promise.all([
      claimMark(t.database, t.ada.id, book.id, 'recap', '2020-02', 3),
      claimMark(t.database, t.ada.id, book.id, 'recap', '2020-02', 3),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await claimMark(t.database, t.grace.id, book.id, 'recap', '2020-03', 1)).toBe(false);
    expect(await claimMark(t.database, t.ada.id, book.id, 'upcoming', '2020-01', 1)).toBe(true);
  });
});

describe(`the daily count of bills waiting (${leg})`, () => {
  it('is sent once for the day with the count and nothing else, by two runs and by two processes, and again the next day', async () => {
    const { fake, channel } = core();
    const made = await createRecurring(t.database, t.ada.id, book.id, {
      template: {
        type: 'expense',
        lines: [
          { account: bank, amount: -9_000, currency: 'USD' },
          { subcategory: food, amount: 9_000, currency: 'USD' },
        ],
        payee: 'City Power',
        note: null,
      },
      unit: 'month',
      every: 1,
      anchor: '2026-11-09',
      mode: 'confirm',
    });
    expect(made.ok).toBe(true);
    const now = at('2026-11-09T09:00:00Z');
    await Promise.all([
      notifyDue(t.database, [channel], now),
      notifyDue(t.database, [channel], now),
    ]);
    await notifyDue(t.database, [channel], at('2026-11-09T15:00:00Z'));
    expect(fake.notificationsSent).toHaveLength(1);
    const sent = fake.notificationsSent[0];
    expect(sent?.title).toBe('1 bill is waiting to be confirmed');
    expect(sent?.to).toBe(SUB);
    expect(sent?.url).toBe('https://ledger.example.com/transactions');
    expect(JSON.stringify(sent)).not.toContain('City Power');
    // The next day it is still waiting, and is said again.
    await notifyDue(t.database, [channel], at('2026-11-10T09:00:00Z'));
    expect(fake.notificationsSent).toHaveLength(2);
  });

  it('is not sent when nothing waits, and nothing is claimed with no channel at all, so a channel turned on later sends nothing that was waiting', async () => {
    const before = await marks();
    expect(await notifyDue(t.database, [], at('2026-11-12T09:00:00Z'))).toEqual({ claimed: 0 });
    expect(await marks()).toBe(before);
    const { fake, channel } = core();
    // A day before anything is due: nothing waits.
    await notifyDue(t.database, [channel], at('2026-11-08T09:00:00Z'));
    expect(fake.notificationsSent).toEqual([]);
  });

  it('is for the book’s own day: at noon UTC on the 15th it is already the 16th in Kiritimati, and the day marked is that one', async () => {
    const { fake, channel } = core();
    const { updateBook } = await import('../ledger/book-settings');
    await updateBook(t.database, t.ada.id, book.id, { timeZone: 'Pacific/Kiritimati' });
    try {
      const now = at('2026-12-15T12:00:00Z');
      await notifyDue(t.database, [channel], now);
      await notifyDue(t.database, [channel], now);
    } finally {
      await updateBook(t.database, t.ada.id, book.id, { timeZone: 'UTC' });
    }
    const upcoming = fake.notificationsSent.filter((each) => each.title.includes('waiting'));
    expect(upcoming).toHaveLength(1);
    const days = await dbAll<{ mark: string }>(
      t.database,
      sql`SELECT mark FROM ${tableNamed(t.database, 'book_job_mark')} WHERE book_id = ${book.id} AND kind = 'upcoming' AND mark = '2026-12-16'`,
    );
    expect(days).toHaveLength(1);
  });
});

describe(`an insight that newly fires (${leg})`, () => {
  it('is sent once for the insight and the month, as the sentence it is, with its link', async () => {
    const { fake, channel } = core();
    const spend = async (date: string, amount: number) => {
      const made = await createTransaction(t.database, t.ada.id, book.id, {
        type: 'expense',
        date,
        lines: [
          { account: bank, amount: -amount, currency: 'USD' },
          { subcategory: food, amount, currency: 'USD' },
        ],
      });
      if (!made.ok) throw new Error('not made');
    };
    // Over its budget of 100 in September and October: Groceries is over again.
    await spend('2026-09-10', 12_000);
    await spend('2026-10-10', 15_000);
    const now = at('2026-11-20T09:00:00Z');
    await notifyDue(t.database, [channel], now);
    await notifyDue(t.database, [channel], at('2026-11-21T09:00:00Z'));
    const insights = fake.notificationsSent.filter((each) =>
      each.title.includes('over its budget'),
    );
    expect(insights).toHaveLength(1);
    expect(insights[0]?.url).toContain('/budget?month=2026-10');
    // The next month it is said again, if it still holds.
    await notifyDue(t.database, [channel], at('2026-12-02T09:00:00Z'));
    expect(
      fake.notificationsSent.filter((each) => each.title.includes('over its budget')).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('says nothing of another person’s book: Grace has no bills, no insight and no claim', async () => {
    const { fake, channel } = core();
    const graces = (await findBook(t.database, t.grace.id)) as Book;
    const before = Number(
      (
        await dbGet<{ n: number | string }>(
          t.database,
          sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'book_job_mark')} WHERE book_id = ${graces.id}`,
        )
      )?.n,
    );
    await notifyDue(t.database, [channel], at('2026-11-20T09:00:00Z'));
    const after = Number(
      (
        await dbGet<{ n: number | string }>(
          t.database,
          sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, 'book_job_mark')} WHERE book_id = ${graces.id}`,
        )
      )?.n,
    );
    expect(after).toBe(before);
    expect(fake.notificationsSent.every((each) => each.to === SUB)).toBe(true);
  });
});
