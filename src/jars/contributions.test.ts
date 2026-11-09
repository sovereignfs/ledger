import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { setBudget } from '../budget/amounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { ensureBook } from '../ledger/books';
import { contributeDue } from './contributions';
import { createJar, listJars, moveMoney, setJarArchived } from './jars';
import { jarNotes } from './notes';
import type { SavingRow } from './saving';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let n = 0;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
});
afterAll(async () => t.close());

const at = (iso: string) => new Date(iso);
const savings = async (opening: number) => {
  const made = await createAccount(t.database, t.ada.id, adas, {
    type: 'savings',
    name: `Savings ${++n}`,
    currency: 'USD',
    opening: { amount: opening, date: '2026-01-01' },
  });
  if (!made.ok) throw new Error(JSON.stringify(made));
  return made.id;
};
/** A jar made on `created`, with a contribution from `from`. */
const jar = async (
  accountId: string,
  monthly: number,
  created = '2027-01-10T12:00:00Z',
  from = '2027-01',
) => {
  const made = await createJar(
    t.database,
    t.ada.id,
    adas,
    { accountId, name: `Jar ${++n}` },
    from,
    at(created).getTime(),
  );
  if (!made.ok) throw new Error(JSON.stringify(made));
  if (monthly > 0)
    await setBudget(t.database, t.ada.id, adas, {
      kind: 'jar',
      targetId: made.id,
      amount: monthly,
      when: 'this',
      currentMonth: from,
    });
  return made.id;
};
const movements = (jarId: string) =>
  dbAll<{ amount: number | string; kind: string; month: string; date: string }>(
    t.database,
    sql`SELECT amount AS amount, kind AS kind, month AS month, date AS date FROM ${tableNamed(t.database, 'jar_movement')} WHERE jar_id = ${jarId} ORDER BY month`,
  );
const balance = async (jarId: string) =>
  (await listJars(t.database, t.ada.id, adas)).find((j) => j.id === jarId)?.balance;

describe(`the monthly contributions (${leg})`, () => {
  it('earmarks a jar of 150 a month on the 1st, once, even with the job run twice and by three at once', async () => {
    const account = await savings(100_000);
    const id = await jar(account, 15_000);
    expect(
      (await contributeDue(t.database, at('2027-02-01T08:00:00Z'))).made,
    ).toBeGreaterThanOrEqual(1);
    await Promise.all([
      contributeDue(t.database, at('2027-02-01T08:00:00Z')),
      contributeDue(t.database, at('2027-02-01T08:00:00Z')),
      contributeDue(t.database, at('2027-02-01T09:00:00Z')),
    ]);
    await contributeDue(t.database, at('2027-02-01T10:00:00Z'));
    expect((await movements(id)).map((m) => [Number(m.amount), m.kind, m.month, m.date])).toEqual([
      [15_000, 'contribution', '2027-02', '2027-02-01'],
    ]);
    expect(await balance(id)).toBe(15_000);
    // The next month, once more.
    await contributeDue(t.database, at('2027-03-01T08:00:00Z'));
    expect(await balance(id)).toBe(30_000);
  });

  it('skips a contribution that does not fit, marks the month, makes none of it, and does not try again that month', async () => {
    const account = await savings(10_000);
    const id = await jar(account, 15_000);
    const first = await contributeDue(t.database, at('2027-02-01T08:00:00Z'));
    expect(first.skipped).toBeGreaterThanOrEqual(1);
    expect((await movements(id)).map((m) => [Number(m.amount), m.kind, m.month])).toEqual([
      [0, 'contribution', '2027-02'],
    ]);
    expect(await balance(id)).toBe(0);
    // Run again later in the month: still skipped, and nothing is made.
    expect((await contributeDue(t.database, at('2027-02-20T08:00:00Z'))).made).toBe(0);
    expect(await balance(id)).toBe(0);
  });

  it('is made the next month when there is room again, after a skipped one', async () => {
    const account = await savings(20_000);
    const id = await jar(account, 15_000);
    await moveMoney(t.database, t.ada.id, adas, id, {
      direction: 'earmark',
      amount: 10_000,
      date: '2027-01-15',
    });
    // 10,000 free of 20,000 less 10,000 earmarked: 15,000 does not fit in February.
    expect(
      (await contributeDue(t.database, at('2027-02-01T08:00:00Z'))).skipped,
    ).toBeGreaterThanOrEqual(1);
    expect(await balance(id)).toBe(10_000);
    await moveMoney(t.database, t.ada.id, adas, id, {
      direction: 'release',
      amount: 10_000,
      date: '2027-02-15',
    });
    await contributeDue(t.database, at('2027-03-01T08:00:00Z'));
    expect(await balance(id)).toBe(15_000);
  });

  it('starts a jar made this month next month', async () => {
    const account = await savings(100_000);
    const id = await jar(account, 15_000, '2027-04-10T12:00:00Z', '2027-04');
    await contributeDue(t.database, at('2027-04-20T08:00:00Z'));
    expect(await movements(id)).toEqual([]);
    await contributeDue(t.database, at('2027-05-01T08:00:00Z'));
    expect(await balance(id)).toBe(15_000);
  });

  it('uses the contribution in force for the month, and nothing when there is none, it has ended, or it starts later', async () => {
    const account = await savings(1_000_000);
    const none = await jar(account, 0);
    const later = await jar(account, 5_000, '2027-01-10T12:00:00Z', '2027-09');
    const ended = await jar(account, 5_000);
    await setBudget(t.database, t.ada.id, adas, {
      kind: 'jar',
      targetId: ended,
      amount: 0,
      when: 'this',
      currentMonth: '2027-06',
    });
    const changed = await jar(account, 5_000);
    await setBudget(t.database, t.ada.id, adas, {
      kind: 'jar',
      targetId: changed,
      amount: 7_000,
      when: 'this',
      currentMonth: '2027-07',
    });
    await contributeDue(t.database, at('2027-06-01T08:00:00Z'));
    expect(await balance(none)).toBe(0);
    expect(await balance(later)).toBe(0);
    expect(await balance(ended)).toBe(0);
    expect(await balance(changed)).toBe(5_000);
    await contributeDue(t.database, at('2027-07-01T08:00:00Z'));
    expect(await balance(changed)).toBe(12_000);
  });

  it('leaves an archived jar alone, and goes by the book’s own calendar', async () => {
    const account = await savings(100_000);
    const archived = await jar(account, 5_000);
    await setJarArchived(t.database, t.ada.id, adas, archived, true);
    const id = await jar(account, 5_000, '2027-08-10T12:00:00Z', '2027-08');
    await contributeDue(t.database, at('2027-08-31T12:00:00Z'));
    expect(await movements(archived)).toEqual([]);
    expect(await balance(id)).toBe(0);
    await dbAll(
      t.database,
      sql`UPDATE ${tableNamed(t.database, 'book')} SET time_zone = 'Pacific/Kiritimati' WHERE id = ${adas} RETURNING id`,
    );
    await contributeDue(t.database, at('2027-08-31T12:00:00Z'));
    expect((await movements(id)).map((m) => m.month)).toEqual(['2027-09']);
    await dbAll(
      t.database,
      sql`UPDATE ${tableNamed(t.database, 'book')} SET time_zone = 'UTC' WHERE id = ${adas} RETURNING id`,
    );
  });
});

describe('what Overview says about jars (pure)', () => {
  const row = (over: Partial<SavingRow>): SavingRow => ({
    id: 'j',
    name: 'Travel',
    accountId: 'a',
    accountName: 'Savings',
    currency: 'USD',
    monthly: 15_000,
    balance: 0,
    target: null,
    progress: null,
    ...over,
  });
  const money = (amount: number, currency: string) => `${currency} ${amount}`;

  it('says a skipped contribution and an over-earmarked account, each with the account to open', () => {
    const notes = jarNotes({
      jars: [row({}), row({ id: 'k', name: 'Car' })],
      skipped: new Set(['j']),
      accounts: [
        { id: 'a', name: 'Savings', currency: 'USD', balance: 30_000, inJars: 40_000 },
        { id: 'b', name: 'Other', currency: 'USD', balance: 50_000, inJars: 10_000 },
      ],
      money,
    });
    expect(notes).toEqual([
      {
        kind: 'skipped',
        text: "Travel: this month's USD 15000 was not set aside, because there was not enough free in Savings.",
        href: '/accounts/a',
      },
      {
        kind: 'over',
        text: 'Savings holds USD 10000 less than its jars. Release some from a jar.',
        href: '/accounts/a',
      },
    ]);
  });

  it('says nothing when everything fits, and nothing of a skipped jar with no contribution', () => {
    expect(
      jarNotes({
        jars: [row({})],
        skipped: new Set(),
        accounts: [{ id: 'a', name: 'Savings', currency: 'USD', balance: 5, inJars: 5 }],
        money,
      }),
    ).toEqual([]);
    expect(
      jarNotes({ jars: [row({ monthly: null })], skipped: new Set(['j']), accounts: [], money }),
    ).toEqual([]);
  });
});
