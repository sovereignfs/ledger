import { describe, expect, it } from 'vitest';
import type { JarRow } from './jars';
import { buildSaving } from './saving';

const jar = (over: Partial<JarRow>): JarRow => ({
  id: 'j',
  accountId: 'a',
  accountName: 'Savings',
  currency: 'USD',
  name: 'Travel',
  target: 300_000,
  position: 0,
  archivedAt: null,
  balance: 75_000,
  ...over,
});

describe('the Saving group', () => {
  it('shows each jar with its contribution in force, balance and progress to its target', () => {
    expect(buildSaving([jar({})], new Map([['jar:j', 15_000]]))).toEqual([
      {
        id: 'j',
        name: 'Travel',
        accountId: 'a',
        accountName: 'Savings',
        currency: 'USD',
        monthly: 15_000,
        balance: 75_000,
        target: 300_000,
        progress: 0.25,
      },
    ]);
  });

  it('says no contribution is set, which is not a contribution of nothing, and no progress without a target', () => {
    const [row] = buildSaving([jar({ target: null })], new Map());
    expect(row).toMatchObject({ monthly: null, progress: null });
    const [ended] = buildSaving([jar({})], new Map([['jar:j', 0]]));
    expect(ended?.monthly).toBe(0);
  });

  it('keeps a contribution to the jar it is of', () => {
    const rows = buildSaving([jar({ id: 'a' }), jar({ id: 'b' })], new Map([['jar:b', 5]]));
    expect(rows.map((r) => r.monthly)).toEqual([null, 5]);
  });
});
