import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { parseTxnInput } from '../access/txn-input';
import { spentInMonth } from '../budget/screen';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { balanceOf } from '../ledger/balances';
import { bulkDelete } from '../ledger/bulk';
import { ensureBook } from '../ledger/books';
import { getEntry, loadEntryOptions } from '../ledger/entries';
import { seedSubcategory } from '../ledger/testing';
import { createTransaction, deleteTransaction, updateTransaction } from '../ledger/transactions';
import type { TxnInput } from '../ledger/validate';
import { accountFigures, createJar, earmarkedByAccount, listJars, moveMoney } from './jars';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
let flights: string;
let n = 0;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  flights = await seedSubcategory(t.database, adas);
});
afterAll(async () => t.close());

const savings = async (opening = 200_000, who: 'ada' | 'grace' = 'ada') => {
  const person = who === 'ada' ? t.ada : t.grace;
  const book = who === 'ada' ? adas : graces;
  const made = await createAccount(t.database, person.id, book, {
    type: 'savings',
    name: `Savings ${++n}`,
    currency: 'USD',
    opening: { amount: opening, date: '2026-01-01' },
  });
  if (!made.ok) throw new Error(JSON.stringify(made));
  return made.id;
};
const jar = async (accountId: string, held: number, who: 'ada' | 'grace' = 'ada') => {
  const person = who === 'ada' ? t.ada : t.grace;
  const book = who === 'ada' ? adas : graces;
  const made = await createJar(
    t.database,
    person.id,
    book,
    { accountId, name: `Jar ${++n}` },
    '2026-11',
  );
  if (!made.ok) throw new Error(JSON.stringify(made));
  if (held > 0)
    await moveMoney(t.database, person.id, book, made.id, {
      direction: 'earmark',
      amount: held,
      date: '2026-02-01',
    });
  return made.id;
};
const flight = (
  account: string,
  amount: number,
  fromJar?: string | null,
  over: Partial<TxnInput> = {},
): TxnInput => ({
  type: 'expense',
  date: '2026-11-04',
  lines: [
    { account, amount: -amount, currency: 'USD' },
    { subcategory: flights, amount, currency: 'USD' },
  ],
  ...(fromJar === undefined ? {} : { fromJar }),
  ...over,
});
const held = async (jarId: string) =>
  (await listJars(t.database, t.ada.id, adas)).find((j) => j.id === jarId)?.balance;
const balance = (account: string) => balanceOf(t.database, t.ada.id, adas, account);
const spentOnFlights = async () =>
  (await spentInMonth(t.database, t.ada.id, adas, '2026-11'))
    .filter((each) => each.subcategoryId === flights)
    .reduce((sum, each) => sum + each.amount, 0);

describe(`spending from a jar (${leg})`, () => {
  it('releases the amount of a 400 flight from the Travel jar, and counts as spending in its subcategory', async () => {
    const before = await spentOnFlights();
    const account = await savings(200_000);
    const travel = await jar(account, 100_000);
    const made = await createTransaction(
      t.database,
      t.ada.id,
      adas,
      flight(account, 40_000, travel),
    );
    expect(made.ok).toBe(true);
    expect(await held(travel)).toBe(60_000);
    expect(await balance(account)).toBe(160_000);
    expect(await spentOnFlights()).toBe(before + 40_000);
    // The account's free money does not change: what left the account left the jar.
    const earmarked = (await earmarkedByAccount(t.database, t.ada.id, adas)).get(account) ?? 0;
    expect(accountFigures(160_000, earmarked)).toMatchObject({ inJars: 60_000, free: 100_000 });
    if (made.ok)
      expect((await getEntry(t.database, t.ada.id, adas, made.id))?.fromJar).toMatchObject({
        id: travel,
      });
  });

  it('refuses more than the jar holds, writing neither the expense nor the movement', async () => {
    const account = await savings(200_000);
    const small = await jar(account, 10_000);
    const refused = await createTransaction(
      t.database,
      t.ada.id,
      adas,
      flight(account, 10_001, small),
    );
    expect(refused).toMatchObject({ ok: false, reason: 'invalid' });
    expect((refused as unknown as { problems: string[] }).problems[0]).toContain('holds less');
    expect(await held(small)).toBe(10_000);
    expect(await balance(account)).toBe(200_000);
  });

  it('refuses a jar of another account, money back, an income, and another person’s jar', async () => {
    const account = await savings();
    const other = await savings();
    const elsewhere = await jar(other, 50_000);
    const mine = await jar(account, 50_000);
    expect(
      await createTransaction(t.database, t.ada.id, adas, flight(account, 100, elsewhere)),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    const back = flight(account, 100, mine, {
      lines: [
        { account, amount: 100, currency: 'USD' },
        { subcategory: flights, amount: -100, currency: 'USD' },
      ],
    });
    expect(await createTransaction(t.database, t.ada.id, adas, back)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    const hers = await savings(100_000, 'grace');
    const herJar = await jar(hers, 5_000, 'grace');
    expect(
      await createTransaction(t.database, t.ada.id, adas, flight(account, 100, herJar)),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await createTransaction(t.database, t.ada.id, adas, flight(account, 100, 'nope')),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await held(mine)).toBe(50_000);
    expect(await balance(account)).toBe(200_000);
  });

  it('restores the jar when the expense is deleted, one at a time or in bulk', async () => {
    const account = await savings(300_000);
    const trip = await jar(account, 100_000);
    const a = await createTransaction(t.database, t.ada.id, adas, flight(account, 25_000, trip));
    const b = await createTransaction(t.database, t.ada.id, adas, flight(account, 15_000, trip));
    const c = await createTransaction(t.database, t.ada.id, adas, flight(account, 5_000, trip));
    if (!a.ok || !b.ok || !c.ok) throw new Error('not made');
    expect(await held(trip)).toBe(55_000);
    expect(await deleteTransaction(t.database, t.ada.id, adas, a.id)).toBe(true);
    expect(await held(trip)).toBe(80_000);
    expect(await bulkDelete(t.database, t.ada.id, adas, [b.id, c.id])).toEqual({
      changed: 2,
      skipped: 0,
    });
    expect(await held(trip)).toBe(100_000);
    // Deleting one that was not from a jar leaves the jar alone.
    const plain = await createTransaction(t.database, t.ada.id, adas, flight(account, 1_000));
    if (!plain.ok) throw new Error('not made');
    await deleteTransaction(t.database, t.ada.id, adas, plain.id);
    expect(await held(trip)).toBe(100_000);
  });

  it('follows the expense when it is changed: its amount, taking the jar off, and moving to another jar', async () => {
    const account = await savings(300_000);
    const one = await jar(account, 50_000);
    const two = await jar(account, 20_000);
    const made = await createTransaction(t.database, t.ada.id, adas, flight(account, 30_000, one));
    if (!made.ok) throw new Error('not made');
    expect(await held(one)).toBe(20_000);
    // A bigger amount: what it took is given back first, so up to everything the jar held is allowed.
    expect(
      (await updateTransaction(t.database, t.ada.id, adas, made.id, flight(account, 50_000, one)))
        .ok,
    ).toBe(true);
    expect(await held(one)).toBe(0);
    // `undefined` keeps the jar and follows the amount.
    expect(
      (await updateTransaction(t.database, t.ada.id, adas, made.id, flight(account, 10_000))).ok,
    ).toBe(true);
    expect(await held(one)).toBe(40_000);
    // Too much is refused, and the jar is as it was.
    expect(
      await updateTransaction(t.database, t.ada.id, adas, made.id, flight(account, 50_001, one)),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await held(one)).toBe(40_000);
    expect((await getEntry(t.database, t.ada.id, adas, made.id))?.lines[0]?.amount).toBe(-10_000);
    // To the other jar.
    expect(
      (await updateTransaction(t.database, t.ada.id, adas, made.id, flight(account, 10_000, two)))
        .ok,
    ).toBe(true);
    expect(await held(one)).toBe(50_000);
    expect(await held(two)).toBe(10_000);
    // Off the jar: it is given back.
    expect(
      (await updateTransaction(t.database, t.ada.id, adas, made.id, flight(account, 10_000, null)))
        .ok,
    ).toBe(true);
    expect(await held(two)).toBe(20_000);
    expect((await getEntry(t.database, t.ada.id, adas, made.id))?.fromJar).toBeNull();
  });

  it('is offered by the add dialog’s options, with what each jar holds', async () => {
    const account = await savings();
    const trip = await jar(account, 12_345);
    const book = await (await import('../ledger/books')).findBook(t.database, t.ada.id);
    const options = await loadEntryOptions(
      t.database,
      t.ada.id,
      { id: adas, baseCurrency: book?.baseCurrency ?? null },
      '2026-11-04',
    );
    expect(options.jars.find((j) => j.id === trip)).toMatchObject({
      accountId: account,
      balance: 12_345,
    });
    const hers = await loadEntryOptions(
      t.database,
      t.grace.id,
      { id: graces, baseCurrency: null },
      '2026-11-04',
    );
    expect(hers.jars.find((j) => j.id === trip)).toBeUndefined();
  });

  it('reads the jar from a request as an id or nothing, and refuses anything else', () => {
    const body = {
      type: 'expense',
      date: '2026-11-04',
      lines: [
        { account: 'a', amount: -1, currency: 'USD' },
        { subcategory: 's', amount: 1, currency: 'USD' },
      ],
    };
    expect(parseTxnInput({ ...body, fromJar: 'j' })).toMatchObject({
      ok: true,
      value: { fromJar: 'j' },
    });
    expect(parseTxnInput({ ...body, fromJar: null })).toMatchObject({
      ok: true,
      value: { fromJar: null },
    });
    expect(parseTxnInput(body)).toMatchObject({ ok: true });
    expect((parseTxnInput(body) as { value: object }).value).not.toHaveProperty('fromJar');
    expect(parseTxnInput({ ...body, fromJar: 5 })).toMatchObject({ ok: false });
  });
});
