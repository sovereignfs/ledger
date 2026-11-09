import { divideRoundHalfEven } from '../money/amount';

/**
 * A loan instalment split into interest and principal (DESIGN.md §8.3), **pure**. Interest is what is left × the yearly rate × the days since the last
 * instalment (or the loan's start) ÷ 365, rounded half to even to the smallest unit, in integers; the principal is the rest of the instalment. **The last
 * instalment is capped at what is left**, so the loan ends at exactly zero. Without a rate the whole instalment is principal.
 */
export interface Split {
  /** What is paid: the instalment, or less on the last one. */
  readonly total: number;
  readonly interest: number;
  readonly principal: number;
  /** Whether this instalment pays the loan off. */
  readonly last: boolean;
}

/** Whole days from one calendar day to a later one, by UTC calendar arithmetic. */
export function daysBetween(from: string, to: string): number {
  const at = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** Interest on `owed` (minor units, not below nothing) at a yearly percentage given as decimal text, for `days`: half to even. A rate that is not one is no interest. */
export function interestFor(owed: number, yearlyRate: string | null, days: number): number {
  if (yearlyRate === null || owed <= 0 || days <= 0) return 0;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(yearlyRate);
  if (!match) return 0;
  const fraction = match[2] ?? '';
  const rate = BigInt(`${match[1]}${fraction}`);
  const denominator = 365n * 100n * 10n ** BigInt(fraction.length);
  return Number(divideRoundHalfEven(BigInt(owed) * rate * BigInt(days), denominator));
}

/**
 * The split of one instalment. `owed` is what is left to pay on the day (the loan account's balance, turned positive), `days` the days since the last
 * instalment. `null` when nothing is owed, which is a loan that is paid off already.
 */
export function splitInstalment(input: {
  owed: number;
  instalment: number;
  yearlyRate: string | null;
  days: number;
}): Split | null {
  const { owed, instalment } = input;
  if (owed <= 0) return null;
  const interest = interestFor(owed, input.yearlyRate, input.days);
  if (owed + interest <= instalment)
    return { total: owed + interest, interest, principal: owed, last: true };
  // An instalment that does not cover the interest is all interest: the loan grows, and the person is told by the balance.
  const principal = Math.max(0, instalment - interest);
  return { total: instalment, interest: instalment - principal, principal, last: false };
}
