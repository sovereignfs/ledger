import { MoneyError, assertMinor, divideRoundHalfEven, sumMinor } from './amount';
import { FX_PIVOT_CODE, currencyOption } from './currencies';

/**
 * Conversion at a date (DESIGN.md §9.3), **pure**: the rates are an argument, so it is tested with no clock and no database. An amount is converted at the rate
 * in force on **its own date**, never today's, through US dollars, and rounded half to even to the target's minor unit once, at the end, on integers.
 *
 * A rate is `rate` units of a currency to one US dollar, a decimal string (task 3.3). It is read as a whole number over a power of ten, so the arithmetic is
 * exact: with `a` minor units of `from` (`df` decimals) and rates `Rf = nf / 10^sf`, `Rt = nt / 10^st` and `dt` decimals for the target,
 *
 *     target minor = a · nt · 10^(dt + sf) / (nf · 10^(df + st))
 *
 * and that is one division, rounded once. **An amount with no rate is not converted and not counted as zero:** `convertMinor` says so, and a total keeps what
 * it left out, by currency, so that the screen can say "1 amount in USD not included" and not guess.
 */

/** What is known of the rates: the one in force on a date, or none. A rate is a decimal string; USD is one on every day. */
export interface RateSource {
  /** Units of `currency` to one US dollar on `date` (`YYYY-MM-DD`), as a decimal string, or `undefined` when there is none that day. */
  on(currency: string, date: string): string | undefined;
}

/** A rate as `numerator / 10^scale`, or `undefined` for text that is not an exact positive decimal. */
export function parseRate(text: string): { numerator: bigint; scale: number } | undefined {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return undefined;
  const fraction = match[2] ?? '';
  if (fraction.length > 30) return undefined;
  const numerator = BigInt(`${match[1]}${fraction}`);
  if (numerator === 0n) return undefined;
  return { numerator, scale: fraction.length };
}

function decimalsOf(code: string): number {
  const option = currencyOption(code);
  if (!option) throw new MoneyError(`${code} is not a currency`);
  return option.decimals;
}

/** The rate of `currency` on `date` as a number over a power of ten, or `undefined` for no rate. A rate that is not exact text is a fault of the source. */
function rateParts(
  rates: RateSource,
  currency: string,
  date: string,
): { numerator: bigint; scale: number } | undefined {
  if (currency === FX_PIVOT_CODE) return { numerator: 1n, scale: 0 };
  const text = rates.on(currency, date);
  if (text === undefined) return undefined;
  const parts = parseRate(text);
  if (!parts) throw new MoneyError(`the rate of ${currency} is not a rate`);
  return parts;
}

/**
 * `amount` in `from`, as it is worth in `to` on `date`, in `to`'s minor units, rounded half to even; or `undefined` when either currency has no rate on that date.
 * The same currency is returned as it is, with no rate needed and no rounding. A currency that is not one, an amount that is not whole, or a result too large to be
 * exact throws a `MoneyError`.
 */
export function convertMinor(
  amount: number,
  from: string,
  to: string,
  date: string,
  rates: RateSource,
): number | undefined {
  assertMinor(amount);
  const fromDecimals = decimalsOf(from);
  const toDecimals = decimalsOf(to);
  if (from === to) return amount;
  const fromRate = rateParts(rates, from, date);
  const toRate = rateParts(rates, to, date);
  if (!fromRate || !toRate) return undefined;
  const numerator = BigInt(amount) * toRate.numerator * 10n ** BigInt(toDecimals + fromRate.scale);
  const denominator = fromRate.numerator * 10n ** BigInt(fromDecimals + toRate.scale);
  const result = divideRoundHalfEven(numerator, denominator);
  const value = Number(result);
  assertMinor(value, 'a converted amount');
  return value;
}

/** An amount of a transaction, with the date it is converted at. */
export interface Dated {
  readonly amount: number;
  readonly currency: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
}

/** What a total left out for one currency: how many amounts, and what they come to **in that currency**, so that nothing is lost by leaving them out. */
export interface NotIncluded {
  readonly currency: string;
  readonly count: number;
  readonly amount: number;
}

/**
 * A total in one currency, and **what is not in it**. `notIncluded` is empty when every amount had a rate; otherwise each currency that was left out is there
 * with its count and sum, in a stable order. A total is never a number that has quietly counted a missing rate as zero.
 */
export interface ConvertedTotal {
  readonly currency: string;
  readonly amount: number;
  /** How many amounts the total is made of. */
  readonly included: number;
  readonly notIncluded: readonly NotIncluded[];
}

/** The sum of `items` in `to`, each converted at its own date, and what could not be converted, by currency. */
export function convertedTotal(
  items: readonly Dated[],
  to: string,
  rates: RateSource,
): ConvertedTotal {
  decimalsOf(to);
  const converted: number[] = [];
  const left = new Map<string, number[]>();
  for (const item of items) {
    const value = convertMinor(item.amount, item.currency, to, item.date, rates);
    if (value === undefined) {
      const amounts = left.get(item.currency) ?? [];
      amounts.push(item.amount);
      left.set(item.currency, amounts);
    } else converted.push(value);
  }
  const notIncluded = [...left.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, amounts]) => ({
      currency,
      count: amounts.length,
      amount: sumMinor(amounts),
    }));
  return { currency: to, amount: sumMinor(converted), included: converted.length, notIncluded };
}

/**
 * What a total left out, in words, one line for each currency: "1 amount in USD not included", "3 amounts in JPY not included". Empty when nothing was left out.
 * (The screens say it in the person's language; this is the sentence of `DESIGN.md` §9.3.)
 */
export function notIncludedLines(total: Pick<ConvertedTotal, 'notIncluded'>): string[] {
  return total.notIncluded.map(
    ({ currency, count }) =>
      `${count} ${count === 1 ? 'amount' : 'amounts'} in ${currency} not included`,
  );
}

/** Rates held in memory: for a currency, its rows by day, and the days they were loaded for. See `RateTable`. */
export interface RateRow {
  readonly currency: string;
  readonly asOf: string;
  readonly rate: string;
}

/**
 * The rates for a range of dates, **loaded once** (`src/fx/load.ts`) and then asked for as many times as a page needs. It holds, for each currency, the rows in
 * the range and the latest one before it, so that the rate in force on any date in the range is found with no further query: the latest row not after the date.
 * A date outside the range it was made for is a mistake and throws, since answering it would mean a "no rate" that the database might not agree with.
 */
export class RateTable implements RateSource {
  private readonly byCurrency = new Map<string, readonly RateRow[]>();

  constructor(
    readonly from: string,
    readonly to: string,
    rows: readonly RateRow[],
  ) {
    const grouped = new Map<string, RateRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.currency) ?? [];
      list.push(row);
      grouped.set(row.currency, list);
    }
    for (const [currency, list] of grouped)
      this.byCurrency.set(
        currency,
        list.sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0)),
      );
  }

  on(currency: string, date: string): string | undefined {
    if (date < this.from || date > this.to)
      throw new RangeError('rates were not loaded for this date');
    if (currency === FX_PIVOT_CODE) return '1';
    const rows = this.byCurrency.get(currency);
    if (!rows) return undefined;
    // The latest row not after the date: a binary search for the last asOf <= date.
    let low = 0;
    let high = rows.length - 1;
    let found: RateRow | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const row = rows[middle];
      if (row === undefined) break;
      if (row.asOf <= date) {
        found = row;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found?.rate;
  }
}
