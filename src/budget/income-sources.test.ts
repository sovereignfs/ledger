import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { storeRates } from '../fx/rates';
import { type Book, ensureBook, findBook } from '../ledger/books';
import { listCurrencies } from '../ledger/currencies';
import { seedAccount } from '../ledger/testing';
import { createTransaction } from '../ledger/transactions';
import { budgetHistory, setBudget } from './amounts';
import { loadIncome, receivedInMonth } from './income';
import {
  createIncomeSource,
  deleteIncomeSource,
  listIncomeSources,
  makePrimary,
  renameIncomeSource,
  setIncomeSourceArchived,
} from './income-sources';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  await dbAll(
    t.database,
    sql`UPDATE ${tableNamed(t.database, 'book')} SET base_currency = 'USD' WHERE id = ${adas} RETURNING id`,
  );
});
afterAll(async () => t.close());

const make = async (name: string, kind?: 'primary' | 'secondary', currency?: string) => {
  const result = await createIncomeSource(t.database, t.ada.id, adas, { name, kind, currency });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
};
const list = () => listIncomeSources(t.database, t.ada.id, adas);
const received = async (
  account: string,
  source: string,
  amount: number,
  date: string,
  currency = 'USD',
) => {
  const result = await createTransaction(t.database, t.ada.id, adas, {
    type: 'income',
    date,
    lines: [
      { account, amount, currency },
      { incomeSource: source, amount: -amount, currency },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
};

describe(`income sources (${leg})`, () => {
  it('make the first one primary, the rest secondary, in the base currency by default; a second primary is refused in a sentence', async () => {
    const salary = await make('Salary');
    const side = await make('Side work');
    const rows = await list();
    expect(rows.map((r) => [r.name, r.kind, r.currency])).toEqual([
      ['Salary', 'primary', 'USD'],
      ['Side work', 'secondary', 'USD'],
    ]);
    expect(rows[0]?.id).toBe(salary);
    expect(side).not.toBe(salary);
    expect(
      await createIncomeSource(t.database, t.ada.id, adas, { name: 'Another', kind: 'primary' }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
      problems: [
        'There is a primary income source already. Make this one primary from the list, which makes the other secondary.',
      ],
    });
  });

  it('are in a currency of their own, which joins the book’s, and names are unique in any case', async () => {
    await make('Euro job', 'secondary', 'EUR');
    expect(await listCurrencies(t.database, t.ada.id, adas)).toContain('EUR');
    for (const [input, fragment] of [
      [{ name: '' }, 'needs a name'],
      [{ name: 'x'.repeat(61) }, 'at most 60'],
      [{ name: 'SALARY' }, 'already an income source'],
      [{ name: 'Ok', currency: 'BTC' }, 'not one'],
      [{ name: 'Ok', kind: 'tertiary' as never }, 'primary or secondary'],
    ] as const)
      expect(
        JSON.stringify(await createIncomeSource(t.database, t.ada.id, adas, input)),
        fragment,
      ).toContain(fragment);
    // The same name in another person's book is theirs to have.
    await dbAll(
      t.database,
      sql`UPDATE ${tableNamed(t.database, 'book')} SET base_currency = 'USD' WHERE id = ${graces} RETURNING id`,
    );
    expect((await createIncomeSource(t.database, t.grace.id, graces, { name: 'Salary' })).ok).toBe(
      true,
    );
  });

  it('need a currency when the book has no base currency yet', async () => {
    // A person whose book setup has not chosen a currency yet. (A book needs no sign-in to exist, so none is made here: a second two-accounts would reset
    // the stores the other tests are using.)
    const person = crypto.randomUUID();
    const book = (await ensureBook(t.database, person)).id;
    expect(await createIncomeSource(t.database, person, book, { name: 'Salary' })).toMatchObject({
      ok: false,
      reason: 'invalid',
      problems: [expect.stringContaining('no base currency')],
    });
    expect(
      (await createIncomeSource(t.database, person, book, { name: 'Salary', currency: 'EUR' })).ok,
    ).toBe(true);
  });

  it('are renamed, with the same rule about names', async () => {
    const id = await make('Rename me', 'secondary');
    expect(await renameIncomeSource(t.database, t.ada.id, adas, id, 'Renamed')).toEqual({
      ok: true,
      id,
    });
    expect(await renameIncomeSource(t.database, t.ada.id, adas, id, 'salary')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(await renameIncomeSource(t.database, t.ada.id, adas, id, 'RENAMED')).toEqual({
      ok: true,
      id,
    });
    expect(await renameIncomeSource(t.database, t.ada.id, adas, id, '   ')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('swap the primary: there is always one, and never two', async () => {
    const was = await make('Was primary swap', 'secondary');
    const before = (await list()).find((s) => s.kind === 'primary')?.id as string;
    expect(await makePrimary(t.database, t.ada.id, adas, was)).toBe(true);
    const rows = await list();
    expect(rows.filter((s) => s.kind === 'primary').map((s) => s.id)).toEqual([was]);
    expect(rows.find((s) => s.id === before)?.kind).toBe('secondary');
    expect(await makePrimary(t.database, t.ada.id, adas, before)).toBe(true);
    expect((await list()).filter((s) => s.kind === 'primary')).toHaveLength(1);
    expect(await makePrimary(t.database, t.ada.id, adas, crypto.randomUUID())).toBe(false);
  });

  it('cannot lose the primary: it is neither archived nor deleted, until another is made primary', async () => {
    const primary = (await list()).find((s) => s.kind === 'primary')?.id as string;
    expect(await setIncomeSourceArchived(t.database, t.ada.id, adas, primary, true)).toBe(
      'primary',
    );
    expect(await deleteIncomeSource(t.database, t.ada.id, adas, primary)).toBe('primary');
    expect((await list()).find((s) => s.id === primary)).toMatchObject({
      kind: 'primary',
      archivedAt: null,
    });
    const other = await make('Next primary', 'secondary');
    await makePrimary(t.database, t.ada.id, adas, other);
    expect(await setIncomeSourceArchived(t.database, t.ada.id, adas, primary, true)).toBe('done');
    expect(await setIncomeSourceArchived(t.database, t.ada.id, adas, primary, false)).toBe('done');
    expect(await deleteIncomeSource(t.database, t.ada.id, adas, primary)).toBe('deleted');
  });

  it('are deleted while nothing has been received from them, with their budgets, and archived after', async () => {
    const used = await make('Used source', 'secondary');
    const free = await make('Free source', 'secondary');
    await setBudget(t.database, t.ada.id, adas, {
      kind: 'income',
      targetId: free,
      amount: 1,
      when: 'this',
      currentMonth: '2026-11',
    });
    const bank = await seedAccount(t.database, adas, 'USD');
    await received(bank, used, 5_000, '2026-11-02');
    expect((await list()).find((s) => s.id === used)?.entries).toBe(1);
    expect(await deleteIncomeSource(t.database, t.ada.id, adas, used)).toBe('in_use');
    expect(await setIncomeSourceArchived(t.database, t.ada.id, adas, used, true)).toBe('done');
    expect(await deleteIncomeSource(t.database, t.ada.id, adas, free)).toBe('deleted');
    expect(await budgetHistory(t.database, t.ada.id, adas, 'income', free)).toEqual([]);
    expect(await deleteIncomeSource(t.database, t.ada.id, adas, free)).toBe('not_found');
  });
});

describe(`income received and budgeted (${leg})`, () => {
  it('shows a month with budgeted and received apart, converted to the base currency, and a missing rate reported', async () => {
    const book = (await findBook(t.database, t.ada.id)) as Book;
    const pay = await make('Month salary', 'secondary');
    const euro = await make('Month euro', 'secondary', 'EUR');
    const swiss = await make('Month swiss', 'secondary', 'CHF');
    const bank = await seedAccount(t.database, adas, 'USD');
    const eurBank = await seedAccount(t.database, adas, 'EUR');
    const chfBank = await seedAccount(t.database, adas, 'CHF');
    await storeRates(t.database, '2026-10-30', new Map([['EUR', '0.9']]), 1);
    await storeRates(t.database, '2026-11-15', new Map([['EUR', '0.8']]), 1);
    await received(bank, pay, 500_000, '2026-11-01');
    await received(eurBank, euro, 45_000, '2026-11-10', 'EUR'); // 450.00 EUR at 0.9 = 500.00 USD
    await received(eurBank, euro, 40_000, '2026-11-20', 'EUR'); // 400.00 EUR at 0.8 = 500.00 USD
    await received(chfBank, swiss, 7_000, '2026-11-05', 'CHF'); // no rate
    await received(bank, pay, 99_999, '2026-10-31'); // another month
    await setBudget(t.database, t.ada.id, adas, {
      kind: 'income',
      targetId: pay,
      amount: 520_000,
      when: 'this',
      currentMonth: '2026-11',
    });
    await setBudget(t.database, t.ada.id, adas, {
      kind: 'income',
      targetId: euro,
      amount: 90_000,
      when: 'this',
      currentMonth: '2026-11',
    });

    expect(
      (await receivedInMonth(t.database, t.ada.id, adas, '2026-11')).filter(
        (r) => r.sourceId === pay,
      ),
    ).toEqual([{ sourceId: pay, currency: 'USD', date: '2026-11-01', amount: 500_000 }]);
    const figures = await loadIncome(
      t.database,
      t.ada.id,
      book,
      '2026-11',
      new Date('2026-12-05T00:00:00Z'),
    );
    expect(figures.base).toBe('USD');
    expect(figures.received).toMatchObject({
      currency: 'USD',
      // the 5,000 is what an earlier test received in November from its own source
      amount: 500_000 + 50_000 + 50_000 + 5_000,
      notIncluded: [{ currency: 'CHF', count: 1, amount: 7_000 }],
    });
    // Budgeted: 5,200.00 USD, and 900.00 EUR at the rate in force at the month's end (0.8) = 1,125.00 USD.
    expect(figures.budgeted).toMatchObject({ currency: 'USD', amount: 520_000 + 112_500 });
    const salary = figures.rows.find((r) => r.source.id === pay);
    expect(salary).toMatchObject({
      budgeted: 520_000,
      received: [{ currency: 'USD', amount: 500_000 }],
    });
    // Another month is another month.
    const october = await loadIncome(
      t.database,
      t.ada.id,
      book,
      '2026-10',
      new Date('2026-12-05T00:00:00Z'),
    );
    expect(october.received).toMatchObject({ amount: 99_999 });
    expect(october.rows.find((r) => r.source.id === pay)?.budgeted).toBeNull();
  });

  it('is nothing of another person’s: their book has no sources and no income', async () => {
    const book = (await findBook(t.database, t.grace.id)) as Book;
    const figures = await loadIncome(t.database, t.grace.id, book, '2026-11');
    expect(figures.rows.map((r) => r.source.name)).toEqual(['Salary']);
    expect(figures.received?.amount).toBe(0);
    expect(await receivedInMonth(t.database, t.grace.id, adas, '2026-11')).toEqual([]);
    expect(await listIncomeSources(t.database, t.grace.id, adas)).toEqual([]);
  });
});

describe(`another person’s income sources (${leg})`, () => {
  it('are not theirs: nothing is listed, renamed, swapped, archived or deleted', async () => {
    const mine = await make('Ada only', 'secondary');
    const before = JSON.stringify(await list());
    expect(await listIncomeSources(t.database, t.grace.id, adas)).toEqual([]);
    expect(await createIncomeSource(t.database, t.grace.id, adas, { name: 'Intruder' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await renameIncomeSource(t.database, t.grace.id, adas, mine, 'Hers')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await renameIncomeSource(t.database, t.grace.id, graces, mine, 'Hers')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await makePrimary(t.database, t.grace.id, adas, mine)).toBe(false);
    expect(await setIncomeSourceArchived(t.database, t.grace.id, adas, mine, true)).toBe(
      'not_found',
    );
    expect(await deleteIncomeSource(t.database, t.grace.id, adas, mine)).toBe('not_found');
    expect(JSON.stringify(await list())).toBe(before);
  });
});
