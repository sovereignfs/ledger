import { describe, expect, it } from 'vitest';
import {
  CURRENCY_OPTIONS,
  FX_PIVOT_CODE,
  currencyDecimals,
  currencyOption,
  currencyScale,
  isSupportedCurrencyCode,
} from './currencies';

describe('the currencies', () => {
  it('are ICU’s ISO 4217 set, each once, and fiat only: no crypto, no unit of account', () => {
    expect(CURRENCY_OPTIONS.length).toBeGreaterThan(150);
    expect(new Set(CURRENCY_OPTIONS.map((c) => c.code)).size).toBe(CURRENCY_OPTIONS.length);
    for (const absent of ['BTC', 'ETH', 'XDR', 'XSU', 'XXX'])
      expect(isSupportedCurrencyCode(absent), absent).toBe(false);
    for (const present of ['EUR', 'USD', 'JPY', 'BHD', 'XAF', 'GBP'])
      expect(isSupportedCurrencyCode(present), present).toBe(true);
  });

  it('are in order, with a name and decimals each', () => {
    const codes = CURRENCY_OPTIONS.map((c) => c.code);
    expect(codes).toEqual([...codes].sort());
    for (const option of CURRENCY_OPTIONS) {
      expect(option.code).toMatch(/^[A-Z]{3}$/);
      expect(option.name.trim()).not.toBe('');
      expect([0, 2, 3, 4]).toContain(option.decimals);
    }
  });

  it('have their own number of decimals: JPY none, EUR two, BHD three', () => {
    expect([currencyDecimals('JPY'), currencyDecimals('EUR'), currencyDecimals('BHD')]).toEqual([
      0, 2, 3,
    ]);
    expect([currencyScale('JPY'), currencyScale('EUR'), currencyScale('BHD')]).toEqual([
      1, 100, 1000,
    ]);
    expect(currencyOption('EUR')?.name).toBe('Euro');
    expect(currencyOption('NOPE')).toBeUndefined();
  });

  it('default to two decimals for a code that is not known, so that an old row renders and does not throw', () => {
    expect(currencyDecimals('NOPE')).toBe(2);
  });

  it('are priced against USD', () => {
    expect(FX_PIVOT_CODE).toBe('USD');
    expect(isSupportedCurrencyCode(FX_PIVOT_CODE)).toBe(true);
  });
});
