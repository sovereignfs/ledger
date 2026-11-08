import { describe, expect, it } from 'vitest';
import { PLACES, placeOf } from './nav';

describe('the places of the app', () => {
  it('are the five of the design, in order, each with its own address', () => {
    expect(PLACES.map((place) => place.id)).toEqual([
      'overview',
      'transactions',
      'budget',
      'accounts',
      'reports',
    ]);
    expect(new Set(PLACES.map((place) => place.href)).size).toBe(5);
  });

  it('are found by the path, and what is under a place is in it', () => {
    expect(placeOf('/')?.id).toBe('overview');
    expect(placeOf('/transactions')?.id).toBe('transactions');
    expect(placeOf('/budget/')?.id).toBe('budget');
    expect(placeOf('/accounts/abc')?.id).toBe('accounts');
    expect(placeOf('/reports')?.id).toBe('reports');
  });

  it('is not Overview for every address, and not a place for a name that merely starts alike', () => {
    expect(placeOf('/account')).toBeUndefined();
    expect(placeOf('/budgets')).toBeUndefined();
    expect(placeOf('/sign-in')).toBeUndefined();
  });
});
