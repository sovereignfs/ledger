import { describe, expect, it } from 'vitest';
import { CURRENCY_OPTIONS, currencyDecimals } from './currencies';
import { decimalText, formatMoney, parseAmount } from './text';

/** `Intl` writes a no-break space where a person sees a space, which a test should not have to type. */
const plain = (text: string) => text.replace(new RegExp('[\u00a0\u202f]', 'g'), ' ');

describe('the decimal text of an amount', () => {
  it('is exact, with the currency’s own number of decimals', () => {
    expect(decimalText(340, 'EUR')).toBe('3.40');
    expect(decimalText(-340, 'EUR')).toBe('-3.40');
    expect(decimalText(5, 'EUR')).toBe('0.05');
    expect(decimalText(0, 'EUR')).toBe('0.00');
    expect(decimalText(1500, 'JPY')).toBe('1500');
    expect(decimalText(1005, 'BHD')).toBe('1.005');
    expect(decimalText(Number.MAX_SAFE_INTEGER, 'EUR')).toBe('90071992547409.91');
  });

  it('refuses what is not an amount', () => {
    expect(() => decimalText(12.5, 'EUR')).toThrow();
  });
});

describe('an amount as it is read', () => {
  it('has the currency’s own decimals: ¥1,500 reads ¥1,500 and not ¥15, and 1.005 BHD keeps its three', () => {
    expect(plain(formatMoney(1500, 'JPY', 'en'))).toBe('¥1,500');
    expect(plain(formatMoney(1005, 'BHD', 'en'))).toBe('BHD 1.005');
    expect(plain(formatMoney(340, 'EUR', 'en'))).toBe('€3.40');
    expect(plain(formatMoney(-340, 'EUR', 'en'))).toBe('-€3.40');
    expect(plain(formatMoney(0, 'USD', 'en'))).toBe('$0.00');
  });

  it('is written with a locale’s own marks', () => {
    expect(plain(formatMoney(123_456, 'EUR', 'de'))).toBe('1.234,56 €');
    expect(plain(formatMoney(123_456, 'EUR', 'fr'))).toBe('1 234,56 €');
  });

  it('is exact for an amount a float could not hold', () => {
    expect(plain(formatMoney(Number.MAX_SAFE_INTEGER, 'EUR', 'en'))).toBe('€90,071,992,547,409.91');
  });
});

describe('an amount as it is typed', () => {
  it('is read into minor units, digit by digit', () => {
    expect(parseAmount('3.40', 'EUR', 'en')).toBe(340);
    expect(parseAmount('3.4', 'EUR', 'en')).toBe(340);
    expect(parseAmount('3', 'EUR', 'en')).toBe(300);
    expect(parseAmount('.5', 'EUR', 'en')).toBe(50);
    expect(parseAmount('1,234.56', 'EUR', 'en')).toBe(123_456);
    expect(parseAmount('  12  ', 'EUR', 'en')).toBe(1200);
    expect(parseAmount('1500', 'JPY', 'en')).toBe(1500);
    expect(parseAmount('1.005', 'BHD', 'en')).toBe(1005);
  });

  it('follows the locale’s decimal mark, so that "1.234" is a thousand in German and a euro and a bit in English', () => {
    expect(parseAmount('1.234,56', 'EUR', 'de')).toBe(123_456);
    expect(parseAmount('1234,5', 'EUR', 'de')).toBe(123_450);
    expect(parseAmount('1 234,56', 'EUR', 'fr')).toBe(123_456);
    expect(parseAmount('1.234', 'EUR', 'de')).toBe(123_400);
    // A comma typed where it is the grouping mark is not read as a decimal mark: refused, so that 3,40 is never 340.
    expect(parseAmount('3,40', 'EUR', 'en')).toBeNull();
    expect(parseAmount('3.40', 'EUR', 'de')).toBeNull();
  });

  it('reads a minus, and "-0" is zero and not a negative zero', () => {
    expect(parseAmount('-3.40', 'EUR', 'en')).toBe(-340);
    expect(parseAmount('−3.40', 'EUR', 'en')).toBe(-340);
    expect(Object.is(parseAmount('-0', 'EUR', 'en'), 0)).toBe(true);
  });

  it('refuses what is not an amount, and more decimals than the currency has, which it does not round', () => {
    for (const text of [
      '',
      ' ',
      '-',
      '.',
      'abc',
      '3.4.5',
      '3,40,1',
      '12e3',
      '1 2 x',
      '3.405',
      '€3.40',
    ])
      expect(parseAmount(text, 'EUR', 'en'), JSON.stringify(text)).toBeNull();
    expect(parseAmount('1500.5', 'JPY', 'en')).toBeNull();
    expect(parseAmount('1.0055', 'BHD', 'en')).toBeNull();
  });

  it('refuses a number too large to be exact', () => {
    expect(parseAmount('90071992547409.91', 'EUR', 'en')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseAmount('90071992547409.92', 'EUR', 'en')).toBeNull();
    expect(parseAmount('9'.repeat(40), 'EUR', 'en')).toBeNull();
  });

  it('round-trips every currency: what is read of what was written is the amount', () => {
    for (const { code } of CURRENCY_OPTIONS)
      for (const minor of [0, 1, 99, 12_345, -12_345, 123_456_789])
        expect(parseAmount(decimalText(minor, code), code, 'en'), `${code} ${minor}`).toBe(minor);
    expect(currencyDecimals('JPY')).toBe(0);
  });
});
