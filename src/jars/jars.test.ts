import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { budgetHistory } from '../budget/amounts';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { ensureBook } from '../ledger/books';
import { createTransaction } from '../ledger/transactions';
import { seedAccount, seedSubcategory } from '../ledger/testing';
import {
  accountFigures,
  createJar,
  earmarkedByAccount,
  listJars,
  moveJar,
  moveMoney,
  progress,
  setJarArchived,
  updateJar,
} from './jars';

const { leg } = testTarget();

describe('a jar’s progress and an account’s figures (pure)', () => {
  it('is how far a jar is to its target, between none and all of it, and nothing without a target', () => {
    expect(progress(25_000, 100_000)).toBe(0.25);
    expect(progress(150_000, 100_000)).toBe(1);
    expect(progress(-5, 100_000)).toBe(0);
    expect(progress(5, null)).toBeNull();
    expect(progress(5, 0)).toBeNull();
  });

  it('says what is free, and when an account holds less than its jars', () => {
    expect(accountFigures(100_000, 40_000)).toEqual({
      balance: 100_000,
      inJars: 40_000,
      free: 60_000,
      overEarmarked: false,
    });
    expect(accountFigures(30_000, 40_000)).toEqual({
      balance: 30_000,
      inJars: 40_000,
      free: -10_000,
      overEarmarked: true,
    });
  });
});

let t: TwoAccounts;
let adas: string;
let graces: string;
let n = 0;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
});
afterAll(async () => t.close());

const account = async (
  who: 'ada' | 'grace',
  over: { type?: string; currency?: string; opening?: number } = {},
) => {
  const person = who === 'ada' ? t.ada : t.grace;
  const book = who === 'ada' ? adas : graces;
  const made = await createAccount(t.database, person.id, book, {
    type: (over.type ?? 'savings') as 'savings',
    name: `Savings ${++n}`,
    currency: over.currency ?? 'USD',
    opening: { amount: over.opening ?? 100_000, date: '2026-01-01' },
  });
  if (!made.ok) throw new Error(JSON.stringify(made));
  return made.id;
};
const jar = async (
  accountId: string,
  name: string,
  extra: { target?: number; monthly?: number } = {},
) => {
  const made = await createJar(
    t.database,
    t.ada.id,
    adas,
    { accountId, name, ...extra },
    '2026-11',
  );
  if (!made.ok) throw new Error(JSON.stringify(made));
  return made.id;
};
const earmark = (jarId: string, amount: number, date = '2026-11-02') =>
  moveMoney(t.database, t.ada.id, adas, jarId, { direction: 'earmark', amount, date });
const release = (jarId: string, amount: number, date = '2026-11-02') =>
  moveMoney(t.database, t.ada.id, adas, jarId, { direction: 'release', amount, date });
const balance = async (jarId: string) =>
  (await listJars(t.database, t.ada.id, adas)).find((j) => j.id === jarId)?.balance;

describe(`making jars (${leg})`, () => {
  it('makes a jar in a savings account with a target and a monthly contribution that has history', async () => {
    const savings = await account('ada');
    const id = await jar(savings, 'Travel', { target: 300_000, monthly: 15_000 });
    expect((await listJars(t.database, t.ada.id, adas)).find((j) => j.id === id)).toMatchObject({
      name: 'Travel',
      target: 300_000,
      balance: 0,
      accountId: savings,
      currency: 'USD',
    });
    expect(
      (await budgetHistory(t.database, t.ada.id, adas, 'jar', id)).map((r) => [
        r.fromMonth,
        r.amount,
      ]),
    ).toEqual([['2026-11', 15_000]]);
  });

  it('refuses, in sentences, a name that is not one, a name already in the account, a target of nothing, and an account that holds no money', async () => {
    const savings = await account('ada');
    await jar(savings, 'Holiday');
    const refused = (
      over: Partial<{ accountId: string; name: string; target: number | null; monthly: number }>,
    ) =>
      createJar(
        t.database,
        t.ada.id,
        adas,
        { accountId: savings, name: 'Other', ...over },
        '2026-11',
      );
    for (const over of [
      { name: '' },
      { name: 'x'.repeat(61) },
      { name: 'holiday' },
      { target: 0 },
      { target: 1.5 },
      { monthly: -1 },
    ])
      expect(await refused(over), JSON.stringify(over)).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    for (const type of ['credit_card', 'loan', 'investment', 'property']) {
      const other = await seedAccount(t.database, adas, 'USD', type);
      expect(await refused({ accountId: other }), type).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    }
    expect(await refused({ accountId: 'nope' })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('renames a jar and changes its target, and refuses a name that is another jar’s', async () => {
    const savings = await account('ada');
    const a = await jar(savings, 'A');
    await jar(savings, 'B');
    expect(
      await updateJar(t.database, t.ada.id, adas, a, { name: 'Alpha', target: 5_000 }),
    ).toEqual({ ok: true, id: a });
    expect((await listJars(t.database, t.ada.id, adas)).find((j) => j.id === a)).toMatchObject({
      name: 'Alpha',
      target: 5_000,
    });
    expect(await updateJar(t.database, t.ada.id, adas, a, { name: 'b' })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(await updateJar(t.database, t.ada.id, adas, a, { target: null })).toEqual({
      ok: true,
      id: a,
    });
    expect((await listJars(t.database, t.ada.id, adas)).find((j) => j.id === a)?.target).toBeNull();
  });
});

describe(`earmarking and releasing (${leg})`, () => {
  it('earmarks within what is free, which other jars in the account take from, and refuses more', async () => {
    const savings = await account('ada', { opening: 100_000 });
    const a = await jar(savings, 'A');
    const b = await jar(savings, 'B');
    expect(await earmark(a, 60_000)).toMatchObject({ ok: true });
    expect(await earmark(b, 40_000)).toMatchObject({ ok: true });
    // Everything is earmarked: not a cent more, in either jar.
    for (const id of [a, b]) {
      const refused = await earmark(id, 1);
      expect(refused).toMatchObject({ ok: false, reason: 'invalid' });
      expect((refused as unknown as { problems: string[] }).problems[0]).toContain(
        'not that much free',
      );
    }
    expect(await balance(a)).toBe(60_000);
    expect(await balance(b)).toBe(40_000);
    expect(
      accountFigures(
        100_000,
        (await earmarkedByAccount(t.database, t.ada.id, adas)).get(savings) ?? 0,
      ),
    ).toMatchObject({ inJars: 100_000, free: 0 });
  });

  it('releases what a jar holds and no more, which frees it for another jar', async () => {
    const savings = await account('ada', { opening: 50_000 });
    const a = await jar(savings, 'A');
    const b = await jar(savings, 'B');
    await earmark(a, 50_000);
    expect(await release(a, 50_001)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await balance(a)).toBe(50_000);
    expect(await release(a, 20_000)).toMatchObject({ ok: true });
    expect(await earmark(b, 20_000)).toMatchObject({ ok: true });
    expect(await release(b, 20_001)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('counts only what the account held on the day of the earmark', async () => {
    const savings = await account('ada', { opening: 10_000 });
    const id = await jar(savings, 'Soon');
    await createTransaction(t.database, t.ada.id, adas, {
      type: 'income',
      date: '2026-12-01',
      lines: [
        { account: savings, amount: 90_000, currency: 'USD' },
        { incomeSource: await incomeSource(), amount: -90_000, currency: 'USD' },
      ],
    });
    expect(await earmark(id, 50_000, '2026-11-15')).toMatchObject({ ok: false });
    expect(await earmark(id, 50_000, '2026-12-01')).toMatchObject({ ok: true });
  });

  it('cannot be earmarked twice past the account by two at once', async () => {
    const savings = await account('ada', { opening: 100_000 });
    const id = await jar(savings, 'Race');
    const other = await jar(savings, 'Race too');
    const results = await Promise.all(
      [id, other, id, other, id, other].map((jarId) => earmark(jarId, 30_000)),
    );
    expect(results.filter((r) => r.ok).length).toBe(3);
    const total = ((await balance(id)) ?? 0) + ((await balance(other)) ?? 0);
    expect(total).toBe(90_000);
  });

  it('refuses a mistake in an amount, a direction or a date, writing nothing', async () => {
    const savings = await account('ada');
    const id = await jar(savings, 'Mistakes');
    for (const input of [
      { direction: 'earmark' as const, amount: 0, date: '2026-11-02' },
      { direction: 'earmark' as const, amount: -5, date: '2026-11-02' },
      { direction: 'earmark' as const, amount: 1.5, date: '2026-11-02' },
      { direction: 'sideways' as never, amount: 5, date: '2026-11-02' },
    ])
      expect(
        await moveMoney(t.database, t.ada.id, adas, id, input),
        JSON.stringify(input),
      ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      await moveMoney(t.database, t.ada.id, adas, id, {
        direction: 'earmark',
        amount: 5,
        date: 'soon',
      }),
    ).toMatchObject({ ok: false });
    expect(await balance(id)).toBe(0);
  });
});

async function incomeSource() {
  const { seedIncomeSource } = await import('../ledger/testing');
  return seedIncomeSource(t.database, adas);
}

describe(`archiving and moving (${leg})`, () => {
  it('archives a jar only when it holds nothing, and brings it back', async () => {
    const savings = await account('ada');
    const id = await jar(savings, 'Old');
    await earmark(id, 1_000);
    expect(await setJarArchived(t.database, t.ada.id, adas, id, true)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    await release(id, 1_000);
    expect(await setJarArchived(t.database, t.ada.id, adas, id, true)).toEqual({ ok: true, id });
    expect((await listJars(t.database, t.ada.id, adas)).find((j) => j.id === id)).toBeUndefined();
    expect(
      (await listJars(t.database, t.ada.id, adas, { archived: true })).find((j) => j.id === id),
    ).toBeDefined();
    expect(await earmark(id, 1)).toEqual({ ok: false, reason: 'not_found' });
    expect(await setJarArchived(t.database, t.ada.id, adas, id, false)).toEqual({ ok: true, id });
    expect(await earmark(id, 1)).toMatchObject({ ok: true });
  });

  it('moves a jar to another account when what it holds is free there, and not otherwise', async () => {
    const from = await account('ada', { opening: 100_000 });
    const roomy = await account('ada', { opening: 100_000 });
    const tight = await account('ada', { opening: 10_000 });
    const euros = await account('ada', { currency: 'EUR', opening: 100_000 });
    const id = await jar(from, 'Mover');
    await earmark(id, 40_000);
    expect(await moveJar(t.database, t.ada.id, adas, id, tight, '2026-11-02')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(await moveJar(t.database, t.ada.id, adas, id, euros, '2026-11-02')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(await moveJar(t.database, t.ada.id, adas, id, 'nope', '2026-11-02')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await moveJar(t.database, t.ada.id, adas, id, roomy, '2026-11-02')).toEqual({
      ok: true,
      id,
    });
    const earmarked = await earmarkedByAccount(t.database, t.ada.id, adas);
    expect(earmarked.get(roomy)).toBe(40_000);
    expect(earmarked.get(from) ?? 0).toBe(0);
    expect((await listJars(t.database, t.ada.id, adas)).find((j) => j.id === id)?.accountId).toBe(
      roomy,
    );
  });
});

describe(`an account over-earmarked by spending (${leg})`, () => {
  it('shows free below nothing once spending takes it below what its jars hold', async () => {
    const savings = await account('ada', { opening: 100_000 });
    const id = await jar(savings, 'Holds all');
    await earmark(id, 100_000);
    await createTransaction(t.database, t.ada.id, adas, {
      type: 'expense',
      date: '2026-11-03',
      lines: [
        { account: savings, amount: -30_000, currency: 'USD' },
        { subcategory: await seedSubcategory(t.database, adas), amount: 30_000, currency: 'USD' },
      ],
    });
    const { balanceOf } = await import('../ledger/balances');
    const figures = accountFigures(
      await balanceOf(t.database, t.ada.id, adas, savings),
      (await earmarkedByAccount(t.database, t.ada.id, adas)).get(savings) ?? 0,
    );
    expect(figures).toEqual({
      balance: 70_000,
      inJars: 100_000,
      free: -30_000,
      overEarmarked: true,
    });
    // Nothing more can be earmarked, and releasing puts it right.
    expect(await earmark(id, 1)).toMatchObject({ ok: false });
    expect(await release(id, 30_000)).toMatchObject({ ok: true });
  });
});

describe(`another person’s jars (${leg})`, () => {
  it('are not theirs: nothing is listed, changed, moved or earmarked, and it reads as not there', async () => {
    const savings = await account('ada');
    const id = await jar(savings, 'Private');
    await earmark(id, 5_000);
    const hers = await account('grace');
    expect(await listJars(t.database, t.grace.id, adas)).toEqual([]);
    expect(await listJars(t.database, t.grace.id, graces)).toEqual([]);
    expect(
      await moveMoney(t.database, t.grace.id, adas, id, {
        direction: 'earmark',
        amount: 1,
        date: '2026-11-02',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await moveMoney(t.database, t.grace.id, graces, id, {
        direction: 'release',
        amount: 1,
        date: '2026-11-02',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await updateJar(t.database, t.grace.id, adas, id, { name: 'Hers' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await setJarArchived(t.database, t.grace.id, adas, id, true)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await moveJar(t.database, t.grace.id, graces, id, hers, '2026-11-02')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(
      await createJar(
        t.database,
        t.grace.id,
        adas,
        { accountId: savings, name: 'Mine now' },
        '2026-11',
      ),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await createJar(t.database, t.ada.id, adas, { accountId: hers, name: 'In hers' }, '2026-11'),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await balance(id)).toBe(5_000);
    expect((await earmarkedByAccount(t.database, t.grace.id, adas)).size).toBe(0);
  });
});
