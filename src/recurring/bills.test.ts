import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { budgetHistory, budgetsForMonth, setBudget } from '../budget/amounts';
import { spentInMonth } from '../budget/screen';
import { testTarget } from '../db/test-support';
import { storeRates } from '../fx/rates';
import { ensureBook } from '../ledger/books';
import { seedAccount, seedSubcategory } from '../ledger/testing';
import { RateTable } from '../money/convert';
import { billsFigure, setBudgetSource, subcategoriesOf } from './bills';
import {
  type NewRecurring,
  type Template,
  createRecurring,
  endRecurring,
  listRecurring,
  postDue,
  updateRecurring,
} from './recurring';

const { leg } = testTarget();
const none = new RateTable('2029-05-15', '2029-05-15', []);

const plain = (sub: string, amount: number, currency = 'USD'): Template => ({
  type: 'expense',
  lines: [
    { account: 'bank', amount: -amount, currency },
    { subcategory: sub, amount, currency },
  ],
  payee: null,
  note: null,
});

describe('what bills come to a month (pure)', () => {
  const entry = (
    unit: 'day' | 'week' | 'month' | 'year',
    every: number,
    amount: number,
    sub = 's',
  ) => ({
    template: plain(sub, amount),
    rule: { unit, every },
  });

  it('is the sum of the monthly equivalents: a yearly 600 is 50, a monthly 1200 is 1200', () => {
    expect(
      billsFigure(
        [entry('year', 1, 60_000), entry('month', 1, 120_000)],
        's',
        'USD',
        '2029-05-15',
        none,
      ),
    ).toEqual({ amount: 125_000, notIncluded: 0 });
  });

  it('counts only the lines on the subcategory, and not another’s entry or a refund', () => {
    expect(
      billsFigure([entry('month', 1, 5_000, 'other')], 's', 'USD', '2029-05-15', none),
    ).toEqual({ amount: 0, notIncluded: 0 });
    const split: Template = {
      type: 'expense',
      lines: [
        { account: 'bank', amount: -1_000, currency: 'USD' },
        { subcategory: 's', amount: 600, currency: 'USD' },
        { subcategory: 'other', amount: 400, currency: 'USD' },
      ],
      payee: null,
      note: null,
    };
    expect(
      billsFigure(
        [{ template: split, rule: { unit: 'month', every: 1 } }],
        's',
        'USD',
        '2029-05-15',
        none,
      ).amount,
    ).toBe(600);
    const refund: Template = {
      ...plain('s', 500),
      lines: [
        { account: 'bank', amount: 500, currency: 'USD' },
        { subcategory: 's', amount: -500, currency: 'USD' },
      ],
    };
    expect(
      billsFigure(
        [{ template: refund, rule: { unit: 'month', every: 1 } }],
        's',
        'USD',
        '2029-05-15',
        none,
      ).amount,
    ).toBe(0);
  });

  it('converts at the rate in force and says what it could not, never counting it as nothing', () => {
    const eur = { template: plain('s', 10_000, 'EUR'), rule: { unit: 'month' as const, every: 1 } };
    expect(billsFigure([eur], 's', 'USD', '2029-05-15', none)).toEqual({
      amount: 0,
      notIncluded: 1,
    });
    const rates = new RateTable('2029-05-15', '2029-05-15', [
      { currency: 'EUR', asOf: '2029-05-01', rate: '0.8' },
    ]);
    expect(billsFigure([eur], 's', 'USD', '2029-05-15', rates)).toEqual({
      amount: 12_500,
      notIncluded: 0,
    });
  });

  it('names the subcategories a template is spent on', () => {
    expect(subcategoriesOf(plain('s', 1)).sort()).toEqual(['s']);
  });
});

let t: TwoAccounts;
let adas: string;
let graces: string;
let bank: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  bank = await seedAccount(t.database, adas, 'USD');
});
afterAll(async () => t.close());
afterEach(async () => {
  for (const each of await listRecurring(t.database, t.ada.id, adas))
    if (each.endedAt === null)
      await endRecurring(t.database, t.ada.id, adas, each.id, Date.UTC(2029, 0, 1));
});

const at = (iso: string) => new Date(iso).getTime();
const spend = (sub: string, amount: number, currency = 'USD') => ({
  type: 'expense' as const,
  lines: [
    { account: bank, amount: -amount, currency },
    { subcategory: sub, amount, currency },
  ],
  payee: null,
  note: null,
});
const bill = async (sub: string, over: Partial<NewRecurring>, now: string) => {
  const made = await createRecurring(
    t.database,
    t.ada.id,
    adas,
    {
      template: spend(sub, 60_000),
      unit: 'year',
      every: 1,
      anchor: '2029-07-01',
      mode: 'auto',
      ...over,
    },
    at(now),
  );
  if (!made.ok) throw new Error(JSON.stringify(made));
  return made.id;
};
const budget = async (sub: string, month: string) =>
  (await budgetsForMonth(t.database, t.ada.id, adas, month)).get(`subcategory:${sub}`);

describe(`a subcategory budgeted by its bills (${leg})`, () => {
  it('budgets a yearly 600 insurance at 50 a month, its payment lands in the month paid, and editing it to 720 from June changes June on and not May', async () => {
    const sub = await seedSubcategory(t.database, adas);
    expect(
      await setBudgetSource(t.database, t.ada.id, adas, sub, 'bills', at('2029-05-10T12:00:00Z')),
    ).toBe(true);
    expect(await budget(sub, '2029-05')).toBe(0);
    const id = await bill(sub, {}, '2029-05-15T12:00:00Z');
    expect(await budget(sub, '2029-05')).toBe(5_000);
    expect(await budget(sub, '2029-06')).toBe(5_000);
    // Edited in June: 720 a year is 60 a month, from June.
    expect(
      await updateRecurring(
        t.database,
        t.ada.id,
        adas,
        id,
        { template: spend(sub, 72_000) },
        at('2029-06-10T12:00:00Z'),
      ),
    ).toEqual({ ok: true, id });
    expect(await budget(sub, '2029-05')).toBe(5_000);
    expect(await budget(sub, '2029-06')).toBe(6_000);
    expect(await budget(sub, '2029-07')).toBe(6_000);
    expect(
      (await budgetHistory(t.database, t.ada.id, adas, 'subcategory', sub)).map((row) => [
        row.fromMonth,
        row.amount,
      ]),
    ).toEqual([
      ['2029-05', 5_000],
      ['2029-06', 6_000],
    ]);
    // The payment lands in the month it is paid, and in no other.
    await postDue(t.database, new Date('2029-07-01T12:00:00Z'));
    const spent = async (month: string) =>
      (await spentInMonth(t.database, t.ada.id, adas, month))
        .filter((each) => each.subcategoryId === sub)
        .reduce((sum, each) => sum + each.amount, 0);
    expect(await spent('2029-06')).toBe(0);
    expect(await spent('2029-07')).toBe(72_000);
    expect(await spent('2029-08')).toBe(0);
  });

  it('adds the monthly equivalents of several bills, and writes a zero from the month the last one ends', async () => {
    const sub = await seedSubcategory(t.database, adas);
    await setBudgetSource(t.database, t.ada.id, adas, sub, 'bills', at('2029-05-01T00:00:00Z'));
    const rent = await bill(
      sub,
      { unit: 'month', template: spend(sub, 100_000) },
      '2029-05-15T12:00:00Z',
    );
    const gym = await bill(
      sub,
      { unit: 'week', every: 2, template: spend(sub, 3_000) },
      '2029-05-15T12:00:00Z',
    );
    // 100,000 + 3,000 × 26/12 = 6,500.
    expect(await budget(sub, '2029-05')).toBe(106_500);
    expect(await endRecurring(t.database, t.ada.id, adas, gym, at('2029-06-02T12:00:00Z'))).toBe(
      true,
    );
    expect(await budget(sub, '2029-05')).toBe(106_500);
    expect(await budget(sub, '2029-06')).toBe(100_000);
    await endRecurring(t.database, t.ada.id, adas, rent, at('2029-07-02T12:00:00Z'));
    expect(await budget(sub, '2029-06')).toBe(100_000);
    expect(await budget(sub, '2029-07')).toBe(0);
  });

  it('writes the budget when the last occurrence of a bill that ran out is posted', async () => {
    const sub = await seedSubcategory(t.database, adas);
    await setBudgetSource(t.database, t.ada.id, adas, sub, 'bills', at('2029-08-01T00:00:00Z'));
    await bill(
      sub,
      { unit: 'month', anchor: '2029-08-20', end: '2029-09-20', template: spend(sub, 4_000) },
      '2029-08-15T12:00:00Z',
    );
    expect(await budget(sub, '2029-08')).toBe(4_000);
    await postDue(t.database, new Date('2029-09-20T12:00:00Z'));
    expect(await budget(sub, '2029-09')).toBe(0);
    expect(await budget(sub, '2029-08')).toBe(4_000);
  });

  it('converts a bill in another currency at the rate in force, and leaves out one with no rate', async () => {
    const sub = await seedSubcategory(t.database, adas);
    await setBudgetSource(t.database, t.ada.id, adas, sub, 'bills', at('2029-10-01T00:00:00Z'));
    const euros = await seedAccount(t.database, adas, 'EUR');
    await bill(
      sub,
      {
        unit: 'month',
        template: {
          ...spend(sub, 10_000, 'EUR'),
          lines: [
            { account: euros, amount: -10_000, currency: 'EUR' },
            { subcategory: sub, amount: 10_000, currency: 'EUR' },
          ],
        },
      },
      '2029-10-15T12:00:00Z',
    );
    expect(await budget(sub, '2029-10')).toBe(0);
    await storeRates(t.database, '2029-10-14', new Map([['EUR', '0.8']]), 1);
    await bill(
      sub,
      { unit: 'month', anchor: '2029-10-16', template: spend(sub, 1_000) },
      '2029-10-15T12:00:00Z',
    );
    expect(await budget(sub, '2029-10')).toBe(13_500);
  });

  it('leaves a subcategory set by hand alone, and refuses a hand-set budget on one set by bills until it is by hand again', async () => {
    const hand = await seedSubcategory(t.database, adas);
    await setBudget(t.database, t.ada.id, adas, {
      kind: 'subcategory',
      targetId: hand,
      amount: 777,
      when: 'this',
      currentMonth: '2029-11',
    });
    await bill(hand, { unit: 'month', template: spend(hand, 1_000) }, '2029-11-05T12:00:00Z');
    expect(await budget(hand, '2029-11')).toBe(777);

    const sub = await seedSubcategory(t.database, adas);
    await setBudgetSource(t.database, t.ada.id, adas, sub, 'bills', at('2029-11-01T00:00:00Z'));
    await bill(sub, { unit: 'month', template: spend(sub, 2_000) }, '2029-11-05T12:00:00Z');
    expect(await budget(sub, '2029-11')).toBe(2_000);
    expect(
      await setBudget(t.database, t.ada.id, adas, {
        kind: 'subcategory',
        targetId: sub,
        amount: 1,
        when: 'this',
        currentMonth: '2029-11',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await budget(sub, '2029-11')).toBe(2_000);
    // By hand again keeps the amount in force, which is then the person's.
    expect(await setBudgetSource(t.database, t.ada.id, adas, sub, 'manual')).toBe(true);
    expect(await budget(sub, '2029-11')).toBe(2_000);
    expect(
      (
        await setBudget(t.database, t.ada.id, adas, {
          kind: 'subcategory',
          targetId: sub,
          amount: 1,
          when: 'this',
          currentMonth: '2029-11',
        })
      ).ok,
    ).toBe(true);
    expect(await budget(sub, '2029-11')).toBe(1);
  });

  it('is the person’s own: another person cannot change how a subcategory is budgeted', async () => {
    const sub = await seedSubcategory(t.database, adas);
    expect(await setBudgetSource(t.database, t.grace.id, adas, sub, 'bills')).toBe(false);
    expect(await setBudgetSource(t.database, t.grace.id, graces, sub, 'bills')).toBe(false);
    expect(await setBudgetSource(t.database, t.ada.id, adas, 'nope', 'bills')).toBe(false);
    // Still by hand: a hand-set budget is accepted.
    expect(
      (
        await setBudget(t.database, t.ada.id, adas, {
          kind: 'subcategory',
          targetId: sub,
          amount: 5,
          when: 'this',
          currentMonth: '2029-12',
        })
      ).ok,
    ).toBe(true);
  });
});
