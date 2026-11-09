import { describe, expect, it } from 'vitest';
import { currencyForLocale, isTimeZone } from './locale';
import { isSupportedCurrencyCode } from '../money/currencies';

describe('the currency a locale suggests', () => {
  it('is the region’s, in any case and with a script in between', () => {
    expect(currencyForLocale('en-US')).toBe('USD');
    expect(currencyForLocale('en-GB')).toBe('GBP');
    expect(currencyForLocale('de-DE')).toBe('EUR');
    expect(currencyForLocale('fr-FR')).toBe('EUR');
    expect(currencyForLocale('ja-JP')).toBe('JPY');
    expect(currencyForLocale('en-au')).toBe('AUD');
    expect(currencyForLocale('zh-Hans-CN')).toBe('CNY');
    expect(currencyForLocale('si-LK')).toBe('LKR');
  });

  it('is dollars where the locale names no region, or one that is not known, and never a code that is not a currency', () => {
    for (const locale of [undefined, '', 'en', 'xx-ZZ', 'not a locale', 'en-', '12-34'])
      expect(currencyForLocale(locale), String(locale)).toBe('USD');
    for (const locale of ['en-US', 'en-GB', 'de-DE', 'ja-JP', 'si-LK', 'pt-BR', 'en-IN', 'ko-KR'])
      expect(isSupportedCurrencyCode(currencyForLocale(locale)), locale).toBe(true);
  });
});

describe('a time zone', () => {
  it('is a name the runtime knows', () => {
    for (const zone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Colombo'])
      expect(isTimeZone(zone), zone).toBe(true);
    for (const zone of [
      '',
      'Not/AZone',
      'Europe/Nowhere',
      5,
      null,
      undefined,
      'x'.repeat(65),
      "'; DROP TABLE book;--",
    ])
      expect(isTimeZone(zone), String(zone)).toBe(false);
  });
});
