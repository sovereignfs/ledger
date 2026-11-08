import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { testTarget } from '../db/test-support';
import { bookIdFor, ensureBook } from './books';
import { addCurrency, listCurrencies } from './currencies';

const { leg } = testTarget();

let t: TwoAccounts;
let adasBook: string;
let gracesBook: string;
beforeAll(async () => {
  t = await twoAccounts();
  adasBook = (await ensureBook(t.database, t.ada.id)).id;
  gracesBook = (await ensureBook(t.database, t.grace.id)).id;
});
afterAll(async () => t.close());

describe(`the currencies of a book (${leg})`, () => {
  it('are added, once each, and listed in order', async () => {
    expect(await addCurrency(t.database, t.ada.id, adasBook, 'USD')).toBe('added');
    expect(await addCurrency(t.database, t.ada.id, adasBook, 'EUR')).toBe('added');
    expect(await addCurrency(t.database, t.ada.id, adasBook, 'EUR')).toBe('exists');
    expect(await listCurrencies(t.database, t.ada.id, adasBook)).toEqual(['EUR', 'USD']);
  });

  it('are made once however many ask at the same moment', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => addCurrency(t.database, t.ada.id, adasBook, 'JPY')),
    );
    expect(results.filter((each) => each === 'added')).toHaveLength(1);
    expect(results.filter((each) => each === 'exists')).toHaveLength(3);
    expect(
      (await listCurrencies(t.database, t.ada.id, adasBook)).filter((c) => c === 'JPY'),
    ).toHaveLength(1);
  });

  it('are refused when the code is not a currency: no crypto, no made-up code, no wrong case, no extra', async () => {
    for (const code of ['BTC', 'XXX', 'ZZZ', 'eur', 'EUR ', '', 'EURO', "EUR'; DROP TABLE book;--"])
      expect(await addCurrency(t.database, t.ada.id, adasBook, code), JSON.stringify(code)).toBe(
        'unsupported',
      );
    expect(await listCurrencies(t.database, t.ada.id, adasBook)).not.toContain('BTC');
  });

  it('are another person’s business: the other person reads and adds nothing there, and it reads as a book that is not there', async () => {
    // Grace asks for Ada's book by its id: nothing is added, nothing is listed, and the answer is the one for a book that never existed.
    expect(await addCurrency(t.database, t.grace.id, adasBook, 'GBP')).toBe('not_found');
    expect(await addCurrency(t.database, t.grace.id, crypto.randomUUID(), 'GBP')).toBe('not_found');
    expect(await listCurrencies(t.database, t.grace.id, adasBook)).toEqual([]);
    expect(await listCurrencies(t.database, t.ada.id, adasBook)).not.toContain('GBP');
    // And hers are hers.
    expect(await addCurrency(t.database, t.grace.id, gracesBook, 'GBP')).toBe('added');
    expect(await listCurrencies(t.database, t.grace.id, gracesBook)).toEqual(['GBP']);
    expect(await listCurrencies(t.database, t.ada.id, gracesBook)).toEqual([]);
    expect(bookIdFor(t.grace.id)).toBe(gracesBook);
  });
});
