import { describe, expect, it } from 'vitest';
import { monthNote } from './month';

describe('the month an entry counts towards', () => {
  it('says nothing for this month, and which month for another, in the year too', () => {
    expect(monthNote('2026-11-02', '2026-11-30')).toBe('');
    expect(monthNote('2026-10-31', '2026-11-01')).toBe('This counts towards October 2026.');
    expect(monthNote('2026-12-01', '2026-11-30')).toBe('This counts towards December 2026.');
    expect(monthNote('2025-11-05', '2026-11-05')).toBe('This counts towards November 2025.');
  });

  it('says nothing for what is not a day', () => {
    expect(monthNote('', '2026-11-05')).toBe('');
    expect(monthNote('soon', '2026-11-05')).toBe('');
    expect(monthNote('2026-11-05', '')).toBe('');
  });
});
