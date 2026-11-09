import { describe, expect, it } from 'vitest';
import { MoneyError } from './amount';
import {
  RateTable,
  convertMinor,
  convertedTotal,
  notIncludedLines,
  parseRate,
  type RateSource,
} from './convert';

/** Rates written down for the test: currency to units per dollar, the same on every day. */
const flat = (rates: Record<string, string>): RateSource => ({ on: (currency) => rates[currency] });

describe('a rate as an exact number', () => {
  it('is read as digits over a power of ten, and refused when it is anything else', () => {
    expect(parseRate('0.9')).toEqual({ numerator: 9n, scale: 1 });
    expect(parseRate('154.38')).toEqual({ numerator: 15438n, scale: 2 });
    expect(parseRate('1')).toEqual({ numerator: 1n, scale: 0 });
    for (const bad of ['0', '0.00', '-1', '1e5', '.5', '1,5', '', 'abc', ` 1`])
      expect(parseRate(bad), JSON.stringify(bad)).toBeUndefined();
  });
});

describe('converting an amount, worked by hand to the minor unit', () => {
  const rates = flat({ EUR: '0.9', JPY: '160', BHD: '0.376' });
  const day = '2026-11-06';

  it('goes from dollars to a currency and back', () => {
    // 100.00 USD at 0.9 is 90.00 EUR; and 90.00 EUR is 100.00 USD.
    expect(convertMinor(10000, 'USD', 'EUR', day, rates)).toBe(9000);
    expect(convertMinor(9000, 'EUR', 'USD', day, rates)).toBe(10000);
  });

  it('goes between two currencies through the dollar, with their own decimals', () => {
    // 50.00 EUR is 62.50 USD, which is 10 000 JPY (no decimals).
    expect(convertMinor(5000, 'EUR', 'JPY', day, flat({ EUR: '0.8', JPY: '160' }))).toBe(10000);
    // 10 000 JPY is 62.50 USD, which is 50.00 EUR.
    expect(convertMinor(10000, 'JPY', 'EUR', day, flat({ EUR: '0.8', JPY: '160' }))).toBe(5000);
  });

  it('reads three decimals as three: 1.000 BHD at 0.376 is 2.66 USD', () => {
    // 1 / 0.376 = 2.65957…, to the cent 2.66.
    expect(convertMinor(1000, 'BHD', 'USD', day, rates)).toBe(266);
    // And 2.66 USD back is 1.000 BHD less rounding: 2.66 × 0.376 = 1.00016 → 1.000.
    expect(convertMinor(266, 'USD', 'BHD', day, rates)).toBe(1000);
  });

  it('rounds half to even, in both directions and for a negative amount', () => {
    const jpy = flat({ JPY: '154.5' });
    // 1.00 USD is 154.5 JPY: the even neighbour is 154. 3.00 USD is 463.5: the even one is 464.
    expect(convertMinor(100, 'USD', 'JPY', day, jpy)).toBe(154);
    expect(convertMinor(300, 'USD', 'JPY', day, jpy)).toBe(464);
    expect(convertMinor(-100, 'USD', 'JPY', day, jpy)).toBe(-154);
    expect(convertMinor(-300, 'USD', 'JPY', day, jpy)).toBe(-464);
    // Not a half: 154.6 goes up, 154.4 goes down.
    expect(convertMinor(100, 'USD', 'JPY', day, flat({ JPY: '154.6' }))).toBe(155);
    expect(convertMinor(100, 'USD', 'JPY', day, flat({ JPY: '154.4' }))).toBe(154);
  });

  it('rounds once, at the end, so that two rates do not round twice', () => {
    // 0.33 USD → EUR at 0.857: 0.28281 → 0.28; through a rounded middle step it could differ. Here the one rounding gives 28.
    expect(convertMinor(33, 'USD', 'EUR', day, flat({ EUR: '0.857' }))).toBe(28);
    // 100.00 EUR → GBP with EUR 0.85 and GBP 0.75: 100 / 0.85 × 0.75 = 88.2352… = 88.24 (rounded once, not 117.65 × 0.75 = 88.2375).
    expect(convertMinor(10000, 'EUR', 'GBP', day, flat({ EUR: '0.85', GBP: '0.75' }))).toBe(8824);
  });

  it('returns the same currency as it is, with no rate needed', () => {
    expect(convertMinor(12345, 'EUR', 'EUR', day, flat({}))).toBe(12345);
    expect(convertMinor(0, 'JPY', 'JPY', day, flat({}))).toBe(0);
  });

  it('is zero for zero, and keeps a negative as a negative', () => {
    expect(convertMinor(0, 'EUR', 'USD', day, rates)).toBe(0);
    expect(convertMinor(-9000, 'EUR', 'USD', day, rates)).toBe(-10000);
  });

  it('is no amount, and not zero, when a rate is missing on either side', () => {
    expect(convertMinor(1000, 'GBP', 'USD', day, rates)).toBeUndefined();
    expect(convertMinor(1000, 'USD', 'GBP', day, rates)).toBeUndefined();
    expect(convertMinor(1000, 'GBP', 'EUR', day, rates)).toBeUndefined();
    expect(convertMinor(1000, 'EUR', 'GBP', day, rates)).toBeUndefined();
  });

  it('is a mistake, not an absence, to give it what is not an amount, a currency or a rate', () => {
    expect(() => convertMinor(12.5, 'EUR', 'USD', day, rates)).toThrow(MoneyError);
    expect(() => convertMinor(1, 'BTC', 'USD', day, rates)).toThrow(MoneyError);
    expect(() => convertMinor(1, 'USD', 'XXX', day, rates)).toThrow(MoneyError);
    expect(() => convertMinor(1, 'EUR', 'USD', day, flat({ EUR: '1e3' }))).toThrow(MoneyError);
    // A result too large to be exact is refused and not rounded off.
    expect(() =>
      convertMinor(Number.MAX_SAFE_INTEGER, 'USD', 'JPY', day, flat({ JPY: '999999' })),
    ).toThrow(MoneyError);
  });

  it('never goes through a float: a long rate loses no digit', () => {
    // 1 000 000.00 USD at 0.123456789012345678 EUR is exactly 123 456.789012345678, which is 123 456.79.
    expect(
      convertMinor(100_000_000, 'USD', 'EUR', day, flat({ EUR: '0.123456789012345678' })),
    ).toBe(12345679);
  });

  it('is symmetric about zero, over many amounts and rates', () => {
    let seed = 12345;
    const next = (to: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % to;
    for (let run = 0; run < 500; run++) {
      const rates = flat({
        EUR: `${next(3) + 0}.${next(9000) + 1000}`.replace(/^0\./, '0.'),
        JPY: `${next(300) + 1}.${next(99)}`,
      });
      const amount = next(10_000_000);
      const forward = convertMinor(amount, 'EUR', 'JPY', '2026-01-01', rates);
      const backward = convertMinor(-amount, 'EUR', 'JPY', '2026-01-01', rates);
      expect(forward).toBeDefined();
      expect(backward).toBe(forward === 0 ? 0 : -(forward as number));
    }
  });
});

describe('a table of rates for a range of days', () => {
  const table = new RateTable('2026-11-05', '2026-11-12', [
    { currency: 'EUR', asOf: '2026-11-09', rate: '0.87' },
    { currency: 'EUR', asOf: '2026-11-03', rate: '0.85' },
    { currency: 'EUR', asOf: '2026-11-06', rate: '0.86' },
    { currency: 'JPY', asOf: '2026-11-10', rate: '154' },
  ]);

  it('gives the latest row not after the date, whatever order the rows came in', () => {
    expect(table.on('EUR', '2026-11-05')).toBe('0.85'); // the row before the range is what is in force at its start
    expect(table.on('EUR', '2026-11-06')).toBe('0.86');
    expect(table.on('EUR', '2026-11-08')).toBe('0.86');
    expect(table.on('EUR', '2026-11-09')).toBe('0.87');
    expect(table.on('EUR', '2026-11-12')).toBe('0.87');
  });

  it('has no rate before a currency’s first row, for one that is absent, and the dollar is always one', () => {
    expect(table.on('JPY', '2026-11-09')).toBeUndefined();
    expect(table.on('JPY', '2026-11-10')).toBe('154');
    expect(table.on('GBP', '2026-11-09')).toBeUndefined();
    expect(table.on('USD', '2026-11-09')).toBe('1');
  });

  it('refuses a date it was not made for, rather than say there is no rate', () => {
    expect(() => table.on('EUR', '2026-11-04')).toThrow(RangeError);
    expect(() => table.on('EUR', '2026-11-13')).toThrow(RangeError);
  });

  it('converts each amount at its own date', () => {
    const rate = (date: string) => convertMinor(10000, 'USD', 'EUR', date, table);
    expect(rate('2026-11-06')).toBe(8600);
    expect(rate('2026-11-09')).toBe(8700);
    expect(rate('2026-11-12')).toBe(8700);
  });
});

describe('a total, and what it leaves out', () => {
  const rates = new RateTable('2026-11-01', '2026-11-30', [
    { currency: 'EUR', asOf: '2026-11-01', rate: '0.9' },
    { currency: 'EUR', asOf: '2026-11-15', rate: '0.8' },
    { currency: 'JPY', asOf: '2026-11-01', rate: '150' },
  ]);

  it('adds each amount converted at its own date', () => {
    const total = convertedTotal(
      [
        { amount: 9000, currency: 'EUR', date: '2026-11-10' }, // 90.00 EUR at 0.9 = 100.00 USD
        { amount: 8000, currency: 'EUR', date: '2026-11-20' }, // 80.00 EUR at 0.8 = 100.00 USD
        { amount: 2550, currency: 'USD', date: '2026-11-20' },
      ],
      'USD',
      rates,
    );
    expect(total).toEqual({ currency: 'USD', amount: 22550, included: 3, notIncluded: [] });
    expect(notIncludedLines(total)).toEqual([]);
  });

  it('leaves out an amount with no rate, says which and how much, and never counts it as zero', () => {
    const total = convertedTotal(
      [
        { amount: 9000, currency: 'EUR', date: '2026-11-10' },
        { amount: 1500, currency: 'GBP', date: '2026-11-10' },
        { amount: 700, currency: 'GBP', date: '2026-11-11' },
        { amount: 100, currency: 'CHF', date: '2026-11-11' },
      ],
      'USD',
      rates,
    );
    expect(total.amount).toBe(10000);
    expect(total.included).toBe(1);
    expect(total.notIncluded).toEqual([
      { currency: 'CHF', count: 1, amount: 100 },
      { currency: 'GBP', count: 2, amount: 2200 },
    ]);
    expect(notIncludedLines(total)).toEqual([
      '1 amount in CHF not included',
      '2 amounts in GBP not included',
    ]);
  });

  it('keeps the same-currency amounts when the target has no rate, and leaves out the rest', () => {
    const total = convertedTotal(
      [
        { amount: 500, currency: 'GBP', date: '2026-11-10' },
        { amount: 9000, currency: 'EUR', date: '2026-11-10' },
      ],
      'GBP',
      rates,
    );
    expect(total).toEqual({
      currency: 'GBP',
      amount: 500,
      included: 1,
      notIncluded: [{ currency: 'EUR', count: 1, amount: 9000 }],
    });
  });

  it('is zero with nothing in it and nothing left out, which is not the same as left out', () => {
    expect(convertedTotal([], 'USD', rates)).toEqual({
      currency: 'USD',
      amount: 0,
      included: 0,
      notIncluded: [],
    });
  });

  it('refuses a target that is not a currency', () => {
    expect(() => convertedTotal([], 'BTC', rates)).toThrow(MoneyError);
  });
});
