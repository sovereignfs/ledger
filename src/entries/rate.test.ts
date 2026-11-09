import { describe, expect, it } from 'vitest';
import { impliedRate, sayRate } from './rate';

describe('the rate a transfer implied', () => {
  it('is the amount that arrived over the amount that left, with each currency’s own decimals', () => {
    expect(impliedRate(10000, 'USD', 9000, 'EUR')).toBe('0.9');
    expect(impliedRate(10000, 'USD', 15438, 'JPY')).toBe('154.38');
    // 1.000 BHD for 2.66 USD: 2.66 / 1 = 2.66.
    expect(impliedRate(1000, 'BHD', 266, 'USD')).toBe('2.66');
    expect(impliedRate(100, 'USD', 100, 'USD')).toBe('1');
  });

  it('is exact, rounded half to even in the millionth, with no trailing zeros', () => {
    // 1 / 3 is 0.333333; 2 / 3 is 0.666667.
    expect(impliedRate(300, 'USD', 100, 'EUR')).toBe('0.333333');
    expect(impliedRate(300, 'USD', 200, 'EUR')).toBe('0.666667');
    expect(impliedRate(100, 'USD', 10000, 'EUR')).toBe('100');
    expect(impliedRate(1, 'JPY', 1, 'KRW')).toBe('1');
    // Exactly half a millionth: 0.0000005 rounds to the even 0.000000 and 0.0000015 to 0.000002.
    expect(impliedRate(2_000_000, 'JPY', 1, 'JPY')).toBe('0');
    expect(impliedRate(2_000_000, 'JPY', 3, 'JPY')).toBe('0.000002');
  });

  it('says nothing for an amount that is not there or not more than nothing', () => {
    for (const [sent, received] of [
      [0, 5],
      [5, 0],
      [-5, 5],
      [5, -5],
      [1.5, 5],
      [5, 1.5],
      [NaN, 5],
    ] as const)
      expect(impliedRate(sent, 'USD', received, 'EUR'), `${sent} ${received}`).toBeUndefined();
  });

  it('is put in words, once both amounts are typed', () => {
    expect(sayRate(10000, 'USD', 9000, 'EUR')).toBe('1 USD = 0.9 EUR');
    expect(sayRate(null, 'USD', 9000, 'EUR')).toBeUndefined();
    expect(sayRate(10000, 'USD', null, 'EUR')).toBeUndefined();
  });
});
