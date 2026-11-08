/**
 * Money, as whole numbers of a currency's smallest unit (DESIGN.md §9.1). **No floating point ever touches an amount:** an amount is a safe integer, sums
 * and splits are exact, and the one place a division happens (a conversion, task 3.4) rounds half to even on integers (`divideRoundHalfEven`). This file is
 * the only place that arithmetic is written, as AGENTS.md says; a column is written only through `assertMinor`.
 */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Whether a value is an amount that may be stored: a whole number a JavaScript number holds exactly (±9 007 199 254 740 991 minor units, which is more than
 * anyone holds in any currency). A float (12.5), a NaN, an infinity, a number too large to be exact, a string and a bigint are not.
 */
export function isMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Throws a `MoneyError` for anything that is not an amount. Every write of a money column goes through this first. */
export function assertMinor(value: unknown, what = 'an amount'): asserts value is number {
  if (!isMinor(value))
    throw new MoneyError(`${what} must be a whole number of the currency’s smallest unit`);
}

/** The sum of two amounts, which must also be an amount: a total too large to be exact is refused and not rounded. */
export function addMinor(a: number, b: number): number {
  assertMinor(a);
  assertMinor(b);
  const sum = a + b;
  assertMinor(sum, 'a total');
  return sum;
}

/** The sum of amounts, exactly, or a `MoneyError`. */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) total = addMinor(total, amount);
  return total;
}

/**
 * `numerator / denominator`, rounded to the nearest whole number, **a half going to the even neighbour** (banker's rounding: 2.5 is 2, 3.5 is 4, -2.5 is
 * -2), in integers. Half to even is what keeps a long run of conversions from drifting one way. The denominator may not be zero.
 */
export function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('cannot divide by zero');
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const quotient = n / d; // truncates toward zero
  const remainder = n % d;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < d) return quotient;
  if (twice > d) return n < 0n ? quotient - 1n : quotient + 1n;
  // Exactly a half: the even one of the two neighbours.
  if (quotient % 2n === 0n) return quotient;
  return n < 0n ? quotient - 1n : quotient + 1n;
}

/**
 * Splits `total` into parts that **add up to it exactly**, for a receipt in several categories or an amount shared in a ratio. `weights` is the number of equal
 * parts, or the shares as whole numbers (the parts are in proportion to them). What does not divide goes out one unit at a time to the parts with the
 * largest remainders, the earlier one first on a tie, so the answer is the same every time. A negative total is split as its absolute value and negated.
 *
 *   splitMinor(10000, 3)       // [3334, 3333, 3333]
 *   splitMinor(1000, [1, 1, 2]) // [250, 250, 500]
 */
export function splitMinor(total: number, weights: number | readonly number[]): number[] {
  assertMinor(total, 'the total');
  const shares = typeof weights === 'number' ? Array.from({ length: weights }, () => 1) : weights;
  if (shares.length === 0 || shares.length > 10_000)
    throw new MoneyError('a split needs at least one part');
  for (const share of shares)
    if (!Number.isSafeInteger(share) || share < 1)
      throw new MoneyError('the shares of a split are whole numbers of at least 1');
  const negative = total < 0;
  const absolute = BigInt(Math.abs(total));
  const sum = shares.reduce((a, b) => a + BigInt(b), 0n);
  const parts = shares.map((share) => {
    const product = absolute * BigInt(share);
    return { whole: product / sum, remainder: product % sum };
  });
  let left = absolute - parts.reduce((a, p) => a + p.whole, 0n);
  const order = parts
    .map((part, at) => ({ at, remainder: part.remainder }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.at - b.at : a.remainder > b.remainder ? -1 : 1,
    );
  for (const { at } of order) {
    if (left === 0n) break;
    const part = parts[at];
    if (part) part.whole += 1n;
    left -= 1n;
  }
  return parts.map((part) => {
    const value = Number(part.whole);
    return negative ? -value : value;
  });
}
