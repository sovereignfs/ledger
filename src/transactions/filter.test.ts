import { describe, expect, it } from 'vitest';
import {
  type EntryFilter,
  filterCount,
  filterQuery,
  parseCursor,
  encodeCursor,
  parseFilter,
} from './filter';

describe('the filter an address says', () => {
  it('reads each filter, from a query string or from the page’s own parameters', () => {
    const full: EntryFilter = {
      account: 'a1',
      category: 'c1',
      subcategory: 's1',
      payee: 'p1',
      type: 'expense',
      status: 'pending',
      from: '2026-10-01',
      to: '2026-10-31',
      q: 'lunch',
    };
    const query = filterQuery(full);
    expect(parseFilter(new URLSearchParams(query))).toEqual(full);
    expect(parseFilter(Object.fromEntries(new URLSearchParams(query)))).toEqual(full);
    // An address reopens the same view: write it, read it, write it again.
    expect(filterQuery(parseFilter(new URLSearchParams(query)))).toBe(query);
  });

  it('is one address for one view, whatever order the parameters came in, and nothing for no filter', () => {
    expect(
      filterQuery(parseFilter(new URLSearchParams('status=cleared&type=income&account=x'))),
    ).toBe('account=x&type=income&status=cleared');
    expect(filterQuery({})).toBe('');
    expect(filterCount({})).toBe(0);
    expect(filterCount({ account: 'x', q: 'y' })).toBe(2);
  });

  it('ignores what is not a filter or not valid, and never fails', () => {
    const parsed = parseFilter(
      new URLSearchParams(
        'type=purchase&status=done&from=2026-02-30&to=soon&account=a b&category=%27%3B--&payee=' +
          'x'.repeat(65) +
          '&unknown=1&q=%20%20',
      ),
    );
    expect(parsed).toEqual({});
    expect(parseFilter({ account: ['first', 'second'], type: undefined })).toEqual({
      account: 'first',
    });
  });

  it('swaps a range that ends before it begins, trims text and caps its length', () => {
    expect(parseFilter({ from: '2026-11-30', to: '2026-11-01' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(parseFilter({ q: '  lunch  ' })).toEqual({ q: 'lunch' });
    expect(parseFilter({ q: 'x'.repeat(500) }).q).toHaveLength(100);
  });

  it('keeps text as text: a % or _ is carried through untouched, for the query to treat as itself', () => {
    expect(parseFilter(new URLSearchParams(filterQuery({ q: '50%_off' }))).q).toBe('50%_off');
  });
});

describe('where the next page starts', () => {
  it('is written and read back, and only a cursor is read', () => {
    const cursor = { date: '2026-11-06', createdAt: 1_800_000_000_123, id: 'abc-123' };
    expect(parseCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(filterQuery({ account: 'a' }, cursor)).toBe(
      'account=a&before=2026-11-06%7E1800000000123%7Eabc-123',
    );
    for (const bad of [
      undefined,
      '',
      'x',
      '2026-02-30~1~a',
      '2026-11-06~x~a',
      '2026-11-06~1~',
      '2026-11-06~1~a b',
      "2026-11-06~1~'; DROP",
    ])
      expect(parseCursor(bad), String(bad)).toBeUndefined();
  });
});
