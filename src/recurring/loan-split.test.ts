import { describe, expect, it } from 'vitest';
import { daysBetween, interestFor, splitInstalment } from './loan-split';

describe('days between', () => {
  it('counts calendar days across months and leap years', () => {
    expect(daysBetween('2026-01-01', '2026-02-01')).toBe(31);
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(28);
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('interest', () => {
  it('is what is left × the yearly rate × days ÷ 365, half to even, in integers', () => {
    // 10,000.00 at 6% for 31 days: 1,000,000 × 0.06 × 31 / 365 = 5,095.89… cents.
    expect(interestFor(1_000_000, '6', 31)).toBe(5_096);
    // A fraction of a percent: 4.5% on 1,000.00 for 30 days = 3.698… → 3.70.
    expect(interestFor(100_000, '4.5', 30)).toBe(370);
  });

  it('rounds an exact half to the even cent', () => {
    // 100 at 365% for 1 day = 1 exactly; 50 at 365% for 1 day = 0.5 → 0; 150 → 1.5 → 2.
    expect(interestFor(50, '365', 1)).toBe(0);
    expect(interestFor(150, '365', 1)).toBe(2);
    expect(interestFor(250, '365', 1)).toBe(2);
  });

  it('is nothing without a rate, a balance, or days, or for a rate that is not one', () => {
    expect(interestFor(1_000_000, null, 31)).toBe(0);
    expect(interestFor(0, '6', 31)).toBe(0);
    expect(interestFor(1_000_000, '6', 0)).toBe(0);
    expect(interestFor(1_000_000, 'six', 31)).toBe(0);
  });
});

describe('an instalment', () => {
  it('splits 10,000 at 6% with 200 a month into the expected first three, to the cent', () => {
    let owed = 1_000_000;
    const days = [31, 28, 31];
    const got = days.map((d) => {
      const split = splitInstalment({ owed, instalment: 20_000, yearlyRate: '6', days: d });
      expect(split).not.toBeNull();
      owed -= split?.principal ?? 0;
      return [split?.interest, split?.principal, split?.total, owed];
    });
    // 31 days: 5,096 interest, 14,904 principal; 28 days on 985,096: 4,534; 31 days on 969,630: 4,941.
    expect(got).toEqual([
      [5_096, 14_904, 20_000, 985_096],
      [4_534, 15_466, 20_000, 969_630],
      [4_941, 15_059, 20_000, 954_571],
    ]);
  });

  it('is all principal without a rate', () => {
    expect(
      splitInstalment({ owed: 100_000, instalment: 20_000, yearlyRate: null, days: 30 }),
    ).toEqual({
      total: 20_000,
      interest: 0,
      principal: 20_000,
      last: false,
    });
  });

  it('caps the last instalment at what is left, interest included, so the loan ends at exactly zero', () => {
    const split = splitInstalment({ owed: 15_000, instalment: 20_000, yearlyRate: '6', days: 30 });
    expect(split).toEqual({ total: 15_000 + 74, interest: 74, principal: 15_000, last: true });
    // Exactly the instalment left is the last one too.
    expect(
      splitInstalment({ owed: 20_000, instalment: 20_000, yearlyRate: null, days: 30 })?.last,
    ).toBe(true);
  });

  it('is nothing when nothing is owed', () => {
    expect(splitInstalment({ owed: 0, instalment: 20_000, yearlyRate: '6', days: 30 })).toBeNull();
    expect(splitInstalment({ owed: -5, instalment: 20_000, yearlyRate: '6', days: 30 })).toBeNull();
  });

  it('never makes a negative principal when the instalment does not cover the interest', () => {
    const split = splitInstalment({
      owed: 10_000_000,
      instalment: 1_000,
      yearlyRate: '12',
      days: 30,
    });
    expect(split).toEqual({ total: 1_000, interest: 1_000, principal: 0, last: false });
  });

  it('pays a loan to exactly zero over its whole life', () => {
    let owed = 1_000_000;
    let paid = 0;
    let count = 0;
    let day = '2026-01-01';
    for (;;) {
      const next = new Date(Date.UTC(2026, count + 1, 1)).toISOString().slice(0, 10);
      const split = splitInstalment({
        owed,
        instalment: 20_000,
        yearlyRate: '6',
        days: daysBetween(day, next),
      });
      if (!split) break;
      owed -= split.principal;
      paid += split.total;
      day = next;
      count++;
      if (split.last) break;
      expect(count).toBeLessThan(100);
    }
    expect(owed).toBe(0);
    expect(count).toBeGreaterThan(50);
    expect(paid).toBeGreaterThan(1_000_000);
  });
});
