import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  addMinor,
  assertMinor,
  divideRoundHalfEven,
  isMinor,
  splitMinor,
  sumMinor,
} from './amount';

describe('what an amount is', () => {
  it('is a whole number a JavaScript number holds exactly', () => {
    for (const ok of [0, 1, -1, 340, -90_000_000_000_000, Number.MAX_SAFE_INTEGER])
      expect(isMinor(ok), String(ok)).toBe(true);
  });

  it('is never a float, a NaN, an infinity, a number too large to be exact, a string or a bigint', () => {
    for (const bad of [
      12.5,
      0.1 + 0.2,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      2 ** 60,
      '340',
      340n,
      null,
      undefined,
      {},
    ])
      expect(isMinor(bad), String(bad)).toBe(false);
  });

  it('is refused by `assertMinor` with a sentence that names what was wrong and never the value', () => {
    expect(() => assertMinor(12.5)).toThrow(MoneyError);
    expect(() => assertMinor(12.5, 'the price')).toThrow(/the price must be a whole number/);
    expect(() => assertMinor(12.5)).not.toThrow(/12\.5/);
    expect(() => assertMinor(340)).not.toThrow();
  });
});

describe('adding', () => {
  it('is exact, where a float is not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMinor(10, 20)).toBe(30);
    expect(sumMinor([1_000_000_000_001, -1, 2])).toBe(1_000_000_000_002);
    expect(sumMinor([])).toBe(0);
  });

  it('refuses a total too large to be exact, and an amount that is not one, and never rounds', () => {
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, 1)).toThrow(MoneyError);
    expect(() => addMinor(1, 0.5)).toThrow(MoneyError);
    expect(() => sumMinor([1, 2, NaN])).toThrow(MoneyError);
  });
});

describe('dividing, half to even', () => {
  const div = (n: number, d: number) => Number(divideRoundHalfEven(BigInt(n), BigInt(d)));

  it('rounds to the nearest whole number', () => {
    expect(div(7, 3)).toBe(2);
    expect(div(8, 3)).toBe(3);
    expect(div(-7, 3)).toBe(-2);
    expect(div(-8, 3)).toBe(-3);
    expect(div(6, 3)).toBe(2);
  });

  it('sends a half to the even neighbour, in both directions, which is what stops a run of conversions drifting', () => {
    expect(div(5, 2)).toBe(2); // 2.5
    expect(div(7, 2)).toBe(4); // 3.5
    expect(div(1, 2)).toBe(0); // 0.5
    expect(div(3, 2)).toBe(2); // 1.5
    expect(div(-5, 2)).toBe(-2);
    expect(div(-7, 2)).toBe(-4);
    expect(div(-1, 2)).toBe(0);
    expect(div(-3, 2)).toBe(-2);
  });

  it('is the same for a negative denominator, and refuses a zero one', () => {
    expect(div(5, -2)).toBe(-2);
    expect(div(-5, -2)).toBe(2);
    expect(() => divideRoundHalfEven(1n, 0n)).toThrow(MoneyError);
  });

  it('is exact past the size of a float: a product of two large amounts is not rounded before it is divided', () => {
    const big = 9_007_199_254_740_991n;
    expect(divideRoundHalfEven(big * 3n, 3n)).toBe(big);
    expect(divideRoundHalfEven(big * 10n + 5n, 10n)).toBe(big + (big % 2n === 0n ? 0n : 1n));
  });
});

describe('splitting', () => {
  it('shares a total so that the parts add up to it exactly: 100.00 three ways', () => {
    const parts = splitMinor(10_000, 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(sumMinor(parts)).toBe(10_000);
  });

  it('shares in proportion to whole shares, and gives what is left to the largest remainders, the earlier first', () => {
    expect(splitMinor(1000, [1, 1, 2])).toEqual([250, 250, 500]);
    expect(splitMinor(100, [1, 2])).toEqual([33, 67]);
    expect(splitMinor(5, [1, 1])).toEqual([3, 2]);
    expect(splitMinor(2, 3)).toEqual([1, 1, 0]);
    expect(splitMinor(0, 3)).toEqual([0, 0, 0]);
    expect(splitMinor(7, 1)).toEqual([7]);
  });

  it('splits a negative total as its absolute value, negated, and a refund adds up too', () => {
    expect(splitMinor(-10_000, 3)).toEqual([-3334, -3333, -3333]);
    expect(sumMinor(splitMinor(-1, 3))).toBe(-1);
  });

  it('adds up for every total and every shares, which is the one property it exists for', () => {
    // A small deterministic generator, so that a failure can be reproduced.
    let seed = 12345;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };
    for (let run = 0; run < 2000; run += 1) {
      const total = next(2) === 0 ? next(1_000_000_000) : -next(1_000_000_000);
      const shares = Array.from({ length: 1 + next(8) }, () => 1 + next(50));
      const parts = splitMinor(total, shares);
      expect(sumMinor(parts), `${total} by ${shares.join(',')}`).toBe(total);
      expect(parts).toHaveLength(shares.length);
      for (const part of parts) expect(Number.isSafeInteger(part)).toBe(true);
    }
  });

  it('refuses a split that is not one: no parts, a share that is not a whole number of at least one, a total that is not an amount', () => {
    expect(() => splitMinor(100, 0)).toThrow(MoneyError);
    expect(() => splitMinor(100, [])).toThrow(MoneyError);
    expect(() => splitMinor(100, [1, 0])).toThrow(MoneyError);
    expect(() => splitMinor(100, [1, 0.5])).toThrow(MoneyError);
    expect(() => splitMinor(100.5, 2)).toThrow(MoneyError);
  });
});
