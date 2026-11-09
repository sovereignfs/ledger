import { afterEach, describe, expect, it } from 'vitest';
import {
  type Rule,
  checkRule,
  describeRule,
  firstOnOrAfter,
  monthlyEquivalent,
  nextOccurrence,
  occurrence,
  occurrenceIs,
  occurrencesBetween,
} from './rule';

const rule = (
  unit: Rule['unit'],
  every: number,
  anchor: string,
  end: string | null = null,
): Rule => ({ unit, every, anchor, end });
const firsts = (r: Rule, n: number) => Array.from({ length: n }, (_, i) => occurrence(r, i));

/** Runs a test body in a time zone, for the zones a rule must not care about. */
const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'] as const;
const original = process.env.TZ;
afterEach(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});
const inEveryZone = (body: () => void) => {
  for (const zone of ZONES) {
    process.env.TZ = zone;
    body();
  }
};

describe('the worked examples', () => {
  it('31 January monthly falls on the last day of a shorter month, and each is counted from the anchor, not the one before', () => {
    expect(firsts(rule('month', 1, '2026-01-31'), 8)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
    ]);
    // A leap year: February has its 29th.
    expect(firsts(rule('month', 1, '2028-01-31'), 3)).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('29 February yearly is the 28th in a year that is not a leap year, and the 29th again in the next that is', () => {
    expect(firsts(rule('year', 1, '2024-02-29'), 6)).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
      '2029-02-28',
    ]);
    expect(firsts(rule('year', 4, '2024-02-29'), 3)).toEqual([
      '2024-02-29',
      '2028-02-29',
      '2032-02-29',
    ]);
  });

  it('every 2 weeks across a change of clocks is 14 calendar days apart, in the United States and in Europe', () => {
    // The US changes on 8 March 2026 and Europe on 29 March.
    const r = rule('week', 2, '2026-02-23');
    expect(firsts(r, 7)).toEqual([
      '2026-02-23',
      '2026-03-09',
      '2026-03-23',
      '2026-04-06',
      '2026-04-20',
      '2026-05-04',
      '2026-05-18',
    ]);
    expect(firsts(rule('week', 2, '2026-10-12'), 4)).toEqual([
      '2026-10-12',
      '2026-10-26',
      '2026-11-09',
      '2026-11-23',
    ]);
  });

  it('every few months keeps the day of the anchor, clamped: every 3 months from the 30th of November', () => {
    expect(firsts(rule('month', 3, '2026-11-30'), 4)).toEqual([
      '2026-11-30',
      '2027-02-28',
      '2027-05-30',
      '2027-08-30',
    ]);
    expect(firsts(rule('month', 12, '2024-02-29'), 3)).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
    ]);
  });

  it('every N days and weeks, with N more than one, over a month end and a year end', () => {
    expect(firsts(rule('day', 10, '2026-12-25'), 4)).toEqual([
      '2026-12-25',
      '2027-01-04',
      '2027-01-14',
      '2027-01-24',
    ]);
    expect(firsts(rule('day', 1, '2028-02-27'), 4)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(firsts(rule('week', 1, '2026-12-28'), 3)).toEqual([
      '2026-12-28',
      '2027-01-04',
      '2027-01-11',
    ]);
  });
});

describe('the next occurrence', () => {
  it('is the first after a day, strictly: the day itself does not count', () => {
    const r = rule('month', 1, '2026-01-31');
    expect(nextOccurrence(r, '2026-01-30')).toBe('2026-01-31');
    expect(nextOccurrence(r, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(r, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(r, '2025-06-01')).toBe('2026-01-31');
    expect(nextOccurrence(r, '2030-06-15')).toBe('2030-06-30');
  });

  it('is nothing once the rule has ended, and the end itself is the last', () => {
    const r = rule('month', 1, '2026-01-15', '2026-03-15');
    expect(firsts(r, 5)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', null, null]);
    expect(nextOccurrence(r, '2026-02-15')).toBe('2026-03-15');
    expect(nextOccurrence(r, '2026-03-15')).toBeNull();
    expect(nextOccurrence(r, '2030-01-01')).toBeNull();
    // An end that is not an occurrence stops after the last one before it.
    expect(firsts(rule('week', 1, '2026-01-05', '2026-01-20'), 4)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      null,
    ]);
  });

  it('knows on or after, and whether a rule falls on a day', () => {
    const r = rule('week', 2, '2026-02-23', '2026-05-01');
    expect(firstOnOrAfter(r, '2026-03-09')).toBe('2026-03-09');
    expect(firstOnOrAfter(r, '2026-03-10')).toBe('2026-03-23');
    expect(firstOnOrAfter(r, '2026-06-01')).toBeNull();
    expect(occurrenceIs(r, '2026-03-23')).toBe(true);
    expect(occurrenceIs(r, '2026-03-24')).toBe(false);
    expect(occurrenceIs(r, '2026-02-09')).toBe(false); // before the anchor, on its fortnight
    expect(occurrenceIs(r, '2026-05-04')).toBe(false); // after the end
    expect(occurrenceIs(rule('month', 1, '2026-01-31'), '2026-02-28')).toBe(true);
    expect(occurrenceIs(rule('month', 1, '2026-01-31'), '2026-02-27')).toBe(false);
  });

  it('is nothing for a day that is not one, or a rule that is not one', () => {
    const r = rule('month', 1, '2026-01-31');
    for (const day of ['', '2026-02-30', 'soon', '2026-1-1'])
      expect(nextOccurrence(r, day), day).toBeNull();
    expect(nextOccurrence(rule('month', 0, '2026-01-31'), '2026-01-01')).toBeNull();
    expect(nextOccurrence(rule('fortnight' as never, 1, '2026-01-31'), '2026-01-01')).toBeNull();
    expect(occurrence(r, -1)).toBeNull();
    expect(occurrence(r, 1.5)).toBeNull();
  });

  it('is the same wherever the machine is: under three zones, the dates do not move', () => {
    inEveryZone(() => {
      expect(firsts(rule('week', 2, '2026-02-23'), 3)).toEqual([
        '2026-02-23',
        '2026-03-09',
        '2026-03-23',
      ]);
      expect(firsts(rule('month', 1, '2026-01-31'), 3)).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
      ]);
      expect(firsts(rule('year', 1, '2024-02-29'), 3)).toEqual([
        '2024-02-29',
        '2025-02-28',
        '2026-02-28',
      ]);
      expect(nextOccurrence(rule('day', 1, '2026-03-07'), '2026-03-07')).toBe('2026-03-08');
      expect(nextOccurrence(rule('day', 1, '2026-03-28'), '2026-03-28')).toBe('2026-03-29');
      expect(occurrencesBetween(rule('week', 1, '2026-03-02'), '2026-03-01', '2026-03-31')).toEqual(
        ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30'],
      );
    });
  });
});

describe('the occurrences between two days', () => {
  it('are those after the first day up to and including the last, oldest first, as many as asked', () => {
    const r = rule('month', 1, '2026-01-31');
    expect(occurrencesBetween(r, '2026-01-31', '2026-05-31')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(occurrencesBetween(r, '2026-01-30', '2026-05-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(occurrencesBetween(r, '2026-01-31', '2026-05-31', 2)).toEqual([
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(occurrencesBetween(r, '2026-05-31', '2026-05-31')).toEqual([]);
    expect(occurrencesBetween(r, '2026-06-01', '2026-01-01')).toEqual([]);
    expect(
      occurrencesBetween(rule('week', 1, '2026-01-05', '2026-01-19'), '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
  });

  it('are what a search for the next, again and again, gives', () => {
    for (const r of [
      rule('month', 1, '2026-01-31'),
      rule('week', 3, '2026-02-02'),
      rule('day', 11, '2026-11-09'),
      rule('year', 1, '2024-02-29'),
      rule('month', 5, '2026-08-30', '2028-12-31'),
    ]) {
      const walked: string[] = [];
      let at = '2026-01-01';
      for (
        let next = nextOccurrence(r, at);
        next !== null && next <= '2030-12-31' && walked.length < 400;
        next = nextOccurrence(r, at)
      ) {
        walked.push(next);
        at = next;
      }
      expect(occurrencesBetween(r, '2026-01-01', '2030-12-31', 400), JSON.stringify(r)).toEqual(
        walked,
      );
    }
  });
});

describe('the rule against a plain walk of the calendar', () => {
  it('agrees with counting forward one day at a time, over many rules', () => {
    let seed = 20261109;
    const random = (n: number) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n;
    for (let run = 0; run < 300; run++) {
      const unit = (['day', 'week', 'month', 'year'] as const)[random(4)] as Rule['unit'];
      const anchor = `${2020 + random(8)}-${String(1 + random(12)).padStart(2, '0')}-${String(1 + random(28) + (random(4) === 0 ? random(3) : 0)).padStart(2, '0')}`;
      if (checkRule(rule(unit, 1, anchor)).length > 0) continue;
      const r = rule(unit, 1 + random(unit === 'year' ? 3 : 20), anchor);
      // The rule's own occurrences are strictly increasing, and the monthly and yearly ones keep the anchor's day, clamped to the month's length.
      const list = occurrencesBetween(r, '2019-12-31', '2040-12-31', 300);
      for (let i = 1; i < list.length; i++)
        expect((list[i] as string) > (list[i - 1] as string), JSON.stringify(r)).toBe(true);
      if (r.unit === 'month' || r.unit === 'year') {
        const wanted = Number(anchor.slice(8, 10));
        for (const date of list) {
          const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
          const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
          expect(Number(date.slice(8, 10)), `${date} of ${JSON.stringify(r)}`).toBe(
            Math.min(wanted, length),
          );
        }
      }
      // And every day between two occurrences is not one.
      if (list.length >= 2) {
        const [a, b] = [list[0] as string, list[1] as string];
        const mid = new Date(
          Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)) + 1),
        )
          .toISOString()
          .slice(0, 10);
        if (mid < b) expect(occurrenceIs(r, mid)).toBe(false);
        expect(occurrenceIs(r, a)).toBe(true);
        expect(nextOccurrence(r, a)).toBe(b);
      }
    }
  });
});

describe('what a rule comes to in a month', () => {
  it('is daily × 365/12, weekly × 52/12, monthly ÷ N and yearly ÷ 12N', () => {
    expect(monthlyEquivalent(rule('year', 1, '2026-01-01'), 60_000)).toBe(5_000); // a yearly 600 is 50 a month
    expect(monthlyEquivalent(rule('year', 2, '2026-01-01'), 120_000)).toBe(5_000);
    expect(monthlyEquivalent(rule('month', 1, '2026-01-01'), 90_000)).toBe(90_000);
    expect(monthlyEquivalent(rule('month', 3, '2026-01-01'), 30_000)).toBe(10_000);
    expect(monthlyEquivalent(rule('week', 1, '2026-01-01'), 12_000)).toBe(52_000);
    expect(monthlyEquivalent(rule('week', 2, '2026-01-01'), 12_000)).toBe(26_000);
    expect(monthlyEquivalent(rule('day', 1, '2026-01-01'), 1_200)).toBe(36_500);
    expect(monthlyEquivalent(rule('day', 2, '2026-01-01'), 1_200)).toBe(18_250);
  });

  it('is rounded half to even to the minor unit, in integers, and keeps the sign', () => {
    // 1 / 12 of 50 is 4.1666…; of 6 it is 0.5, which goes to the even 0; of 18 it is 1.5, which goes to the even 2.
    expect(monthlyEquivalent(rule('year', 1, '2026-01-01'), 50)).toBe(4);
    expect(monthlyEquivalent(rule('year', 1, '2026-01-01'), 6)).toBe(0);
    expect(monthlyEquivalent(rule('year', 1, '2026-01-01'), 18)).toBe(2);
    expect(monthlyEquivalent(rule('year', 1, '2026-01-01'), -18)).toBe(-2);
    expect(monthlyEquivalent(rule('week', 1, '2026-01-01'), 1_001)).toBe(
      Math.round((1_001 * 52) / 12),
    );
    expect(monthlyEquivalent(rule('month', 7, '2026-01-01'), 0)).toBe(0);
  });

  it('refuses what is not an amount or a repeat', () => {
    expect(() => monthlyEquivalent(rule('month', 1, '2026-01-01'), 1.5)).toThrow(RangeError);
    expect(() => monthlyEquivalent(rule('month', 0, '2026-01-01'), 100)).toThrow(RangeError);
    expect(() => monthlyEquivalent(rule('month', 1.5, '2026-01-01'), 100)).toThrow(RangeError);
  });
});

describe('a rule that may be used', () => {
  it('is checked in sentences', () => {
    expect(checkRule(rule('month', 1, '2026-01-31'))).toEqual([]);
    expect(checkRule(rule('month', 999, '2026-01-31', '2026-01-31'))).toEqual([]);
    expect(checkRule(rule('month', 0, '2026-01-31'))[0]).toContain('1 to 999');
    expect(checkRule(rule('month', 1000, '2026-01-31'))[0]).toContain('1 to 999');
    expect(checkRule(rule('month', 1.5, '2026-01-31'))[0]).toContain('1 to 999');
    expect(checkRule(rule('hour' as never, 1, '2026-01-31'))[0]).toContain(
      'days, weeks, months or years',
    );
    expect(checkRule(rule('month', 1, '2026-02-30'))[0]).toContain('day it starts');
    expect(checkRule(rule('month', 1, '2026-03-01', '2026-02-28'))[0]).toContain(
      'does not end before it starts',
    );
    expect(checkRule(rule('month', 1, '2026-03-01', 'soon'))[0]).toContain(
      'does not end before it starts',
    );
  });

  it('is put in words', () => {
    expect(describeRule(rule('month', 1, '2026-01-31'))).toBe('Every month');
    expect(describeRule(rule('week', 2, '2026-01-31', '2027-06-30'))).toBe(
      'Every 2 weeks, until 2027-06-30',
    );
    expect(describeRule(rule('year', 1, '2026-01-31'))).toBe('Every year');
  });
});
