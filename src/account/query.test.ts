import { describe, expect, it } from 'vitest';
import { SECTIONS, one, sectionOf } from './query';

describe('the section an address asks for', () => {
  it('is the one it names, when there is one', () => {
    for (const section of SECTIONS) expect(sectionOf({ section })).toBe(section);
  });

  it('is Profile for nothing, for a section that does not exist yet, and for what an object inherits', () => {
    for (const section of [undefined, '', 'billing', 'SECURITY', 'toString', '__proto__'])
      expect(sectionOf({ section }), String(section)).toBe('profile');
  });

  it('takes the first value of a parameter that is only one, and nothing from a repeated one', () => {
    expect(one('security')).toBe('security');
    expect(one(['security', 'data'])).toBeUndefined();
    expect(one(undefined)).toBeUndefined();
  });
});
