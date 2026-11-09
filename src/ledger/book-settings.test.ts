import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { loadOverview } from '../accounts/overview';
import { dbGet } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { storeRates } from '../fx/rates';
import { createRecurring, listRecurring, postDue } from '../recurring/recurring';
import { createAccount } from './accounts';
import { type BookPatch, checkBookPatch, isLocaleTag, updateBook } from './book-settings';
import { listCurrencies } from './currencies';
import { ensureBook, findBook, type Book } from './books';
import { seedSubcategory } from './testing';
import { setupCurrency } from '../setup/setup';

const { leg } = testTarget();

describe('what a change to the book may be (pure)', () => {
  it('accepts what is a name, a currency, a zone, a day of the week, a locale and the recap, and says nothing for nothing', () => {
    expect(checkBookPatch({})).toEqual([]);
    expect(
      checkBookPatch({
        name: ' Home ',
        baseCurrency: 'EUR',
        timeZone: 'Europe/Paris',
        firstDayOfWeek: 0,
        locale: 'de-DE',
        recap: false,
      }),
    ).toEqual([]);
    expect(checkBookPatch({ locale: null })).toEqual([]);
  });

  it('refuses, in a sentence each, what is not', () => {
    const refused = (patch: BookPatch) => checkBookPatch(patch);
    expect(refused({ name: '  ' })).toEqual(['The book needs a name.']);
    expect(refused({ name: 'x'.repeat(81) })).toHaveLength(1);
    expect(refused({ baseCurrency: 'BTC' })).toEqual(['Choose a currency.']);
    expect(refused({ baseCurrency: 'usd' })).toHaveLength(1);
    expect(refused({ timeZone: 'Mars/Olympus' })).toEqual(['The time zone is not one.']);
    for (const day of [-1, 7, 1.5, Number.NaN])
      expect(refused({ firstDayOfWeek: day }), String(day)).toHaveLength(1);
    expect(refused({ locale: 'not a locale' })).toHaveLength(1);
    expect(refused({ recap: 'yes' as never })).toHaveLength(1);
    expect(refused({ name: '', baseCurrency: 'BTC', timeZone: 'x' })).toHaveLength(3);
  });

  it('knows a locale tag from text', () => {
    expect(isLocaleTag('en-US')).toBe(true);
    expect(isLocaleTag('de')).toBe(true);
    expect(isLocaleTag('')).toBe(false);
    expect(isLocaleTag('en_US_x')).toBe(false);
    expect(isLocaleTag(5)).toBe(false);
  });
});

let t: TwoAccounts;
let adas: Book;
const NOW = new Date('2026-11-09T12:00:00Z');
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  adas = (await findBook(t.database, t.ada.id)) as Book;
});
afterAll(async () => t.close());

describe(`changing the book's settings (${leg})`, () => {
  it('changes only what is given, joins a new base currency to the book’s currencies, and leaves the other person’s book as it was', async () => {
    const before = (await findBook(t.database, t.grace.id)) as Book;
    expect(
      await updateBook(t.database, t.ada.id, adas.id, {
        name: '  Our budget ',
        timeZone: 'Europe/Paris',
        baseCurrency: 'EUR',
        firstDayOfWeek: 0,
        locale: 'de-DE',
        recap: false,
      }),
    ).toEqual({ ok: true, id: adas.id });
    const now = (await findBook(t.database, t.ada.id)) as Book;
    expect(now).toMatchObject({
      name: 'Our budget',
      timeZone: 'Europe/Paris',
      baseCurrency: 'EUR',
      firstDayOfWeek: 0,
      locale: 'de-DE',
      recap: false,
    });
    expect(await listCurrencies(t.database, t.ada.id, adas.id)).toContain('EUR');
    expect(await updateBook(t.database, t.ada.id, adas.id, { locale: null })).toEqual({
      ok: true,
      id: adas.id,
    });
    expect(((await findBook(t.database, t.ada.id)) as Book).locale).toBeNull();
    expect(((await findBook(t.database, t.ada.id)) as Book).name).toBe('Our budget');
    expect(await findBook(t.database, t.grace.id)).toEqual(before);
  });

  it('refuses a mistake with sentences and writes nothing, and a book that is not the caller’s is not found', async () => {
    const before = (await findBook(t.database, t.ada.id)) as Book;
    expect(
      await updateBook(t.database, t.ada.id, adas.id, { name: '', baseCurrency: 'BTC' }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await findBook(t.database, t.ada.id)).toEqual(before);
    expect(await updateBook(t.database, t.grace.id, adas.id, { name: 'Hers now' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(((await findBook(t.database, t.ada.id)) as Book).name).toBe(before.name);
  });
});

describe(`what changing them does (${leg})`, () => {
  it('re-reports every figure in a new base currency with nothing stored changed', async () => {
    const id = t.grace.id;
    const book = (await findBook(t.database, id)) as Book;
    await setupCurrency(
      t.database,
      id,
      book.id,
      { currency: 'USD', timeZone: 'UTC' },
      NOW.getTime(),
    );
    await storeRates(t.database, '2026-11-01', new Map([['EUR', '0.8']]), 1);
    await createAccount(t.database, id, book.id, {
      type: 'bank',
      name: 'Dollars',
      currency: 'USD',
      opening: { amount: 100_000, date: '2026-01-01' },
    });
    await createAccount(t.database, id, book.id, {
      type: 'bank',
      name: 'Euros',
      currency: 'EUR',
      opening: { amount: 80_000, date: '2026-01-01' },
    });
    const stored = async () =>
      dbGet<{ n: number | string; total: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n, SUM(amount) AS total FROM ${tableNamed(t.database, 'txn_line')} WHERE book_id = ${book.id}`,
      );
    const lines = await stored();
    const inDollars = await loadOverview(
      t.database,
      id,
      (await findBook(t.database, id)) as Book,
      NOW,
    );
    // 1,000 dollars and 800 euros at 1.25: 2,000 dollars.
    expect(inDollars.netWorth.total?.amount).toBe(200_000);
    expect(await updateBook(t.database, id, book.id, { baseCurrency: 'EUR' })).toEqual({
      ok: true,
      id: book.id,
    });
    const inEuros = await loadOverview(
      t.database,
      id,
      (await findBook(t.database, id)) as Book,
      NOW,
    );
    expect(inEuros.baseCurrency).toBe('EUR');
    // The same book, said in euros: 2,000 dollars is 1,600 euros.
    expect(inEuros.netWorth.total?.amount).toBe(160_000);
    expect(await stored()).toEqual(lines);
  });

  it('moves when the next posting happens, which is by the book’s own day', async () => {
    const id = t.ada.id;
    const bank = await createAccount(t.database, id, adas.id, {
      type: 'bank',
      name: 'Bank',
      currency: 'USD',
      opening: { amount: 100_000, date: '2026-01-01' },
    });
    if (!bank.ok) throw new Error('not made');
    const sub = await seedSubcategory(t.database, adas.id);
    await updateBook(t.database, id, adas.id, { timeZone: 'UTC' });
    const made = await createRecurring(t.database, id, adas.id, {
      template: {
        type: 'expense',
        lines: [
          { account: bank.id, amount: -500, currency: 'USD' },
          { subcategory: sub, amount: 500, currency: 'USD' },
        ],
        payee: null,
        note: null,
      },
      unit: 'month',
      every: 1,
      anchor: '2027-05-02',
      mode: 'auto',
    });
    if (!made.ok) throw new Error('not made');
    const posted = async () =>
      (await listRecurring(t.database, id, adas.id)).find((r) => r.id === made.id)?.nextDate;
    const instant = new Date('2027-05-01T12:00:00Z');
    await postDue(t.database, instant);
    expect(await posted()).toBe('2027-05-02');
    // In Kiritimati (+14) it is already the 2nd.
    await updateBook(t.database, id, adas.id, { timeZone: 'Pacific/Kiritimati' });
    await postDue(t.database, instant);
    expect(await posted()).toBe('2027-06-02');
    await updateBook(t.database, id, adas.id, { timeZone: 'UTC' });
  });
});
