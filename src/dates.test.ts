import { describe, expect, it } from 'vitest';
import { isCalendarDay, todayIn } from './dates';

describe('a calendar day', () => {
  it('is a real day written in full', () => {
    expect(isCalendarDay('2026-11-09')).toBe(true);
    expect(isCalendarDay('2028-02-29')).toBe(true);
    for (const bad of [
      '2026-02-29',
      '2026-13-01',
      '2026-11-31',
      '2026-1-1',
      '26-11-09',
      '',
      '2026-11-09T00:00',
    ])
      expect(isCalendarDay(bad), bad).toBe(false);
  });
});

describe('today in a time zone', () => {
  const instant = new Date('2026-11-09T23:30:00Z');
  it('is the day on that zone’s own clock', () => {
    expect(todayIn('UTC', instant)).toBe('2026-11-09');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-11-10');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-11-09');
    expect(todayIn('Pacific/Kiritimati', new Date('2026-11-09T11:00:00Z'))).toBe('2026-11-10');
  });

  it('falls back to UTC for a zone that is not one, and fails nothing', () => {
    expect(todayIn('Not/AZone', instant)).toBe('2026-11-09');
    expect(todayIn('', instant)).toBe('2026-11-09');
  });
});
