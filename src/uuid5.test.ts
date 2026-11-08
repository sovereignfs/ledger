import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LEDGER_NAMESPACE, uuid5 } from './uuid5';

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** The same thing by Node's own SHA-1, so that the one written out here is held to a second opinion on inputs of every length. */
function reference(name: string, namespace: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(name)
    .digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

describe('a name-based id', () => {
  it('is the one RFC 4122’s own example gives, and the one Python and Node give', () => {
    expect(uuid5('www.example.com', DNS)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuid5('python.org', DNS)).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('agrees with Node’s SHA-1 on names of every length around a block boundary, and on text that is not ASCII', () => {
    for (let length = 0; length < 200; length++) {
      const name = 'x'.repeat(length);
      expect(uuid5(name, LEDGER_NAMESPACE), `${length}`).toBe(reference(name, LEDGER_NAMESPACE));
    }
    for (const name of ['Wasserstraße', '日本語', '😀 emoji', 'a\u0000b']) {
      expect(uuid5(name, LEDGER_NAMESPACE)).toBe(reference(name, LEDGER_NAMESPACE));
    }
  });

  it('is version 5 with the RFC variant, and one id for one name, whichever device asks', () => {
    const id = uuid5('account-1', LEDGER_NAMESPACE);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid5('account-1', LEDGER_NAMESPACE)).toBe(id);
    expect(uuid5('account-2', LEDGER_NAMESPACE)).not.toBe(id);
    expect(uuid5('account-1', DNS)).not.toBe(id);
  });

  it('is an id of the shape every id here has: a lower-case UUID, version 5, of the RFC variant', () => {
    expect(uuid5('a better-auth user id', LEDGER_NAMESPACE)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('refuses a namespace that is not an id', () => {
    expect(() => uuid5('x', 'nope')).toThrow();
  });
});
