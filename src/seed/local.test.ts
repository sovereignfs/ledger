import { describe, expect, it } from 'vitest';
import type { DatabaseConfig } from '../db/config';
import { isLocalDatabase } from './local';

const sqld = (url: string): DatabaseConfig => ({
  dialect: 'sqlite',
  form: 'sqld',
  url,
  adminUrl: url,
});
const postgres = (url: string): DatabaseConfig => ({ dialect: 'postgres', url, poolMax: 1 });

describe('which databases the seed may write to', () => {
  it('is a file, and a service on this machine', () => {
    expect(
      isLocalDatabase({ dialect: 'sqlite', form: 'file', path: '/x/a.db', authPath: '/x/b.db' }),
    ).toBe(true);
    expect(isLocalDatabase(sqld('http://localhost:28080'))).toBe(true);
    expect(isLocalDatabase(sqld('http://127.0.0.1:8080'))).toBe(true);
    expect(isLocalDatabase(postgres('postgres://ledger:ledger@localhost:25432/ledger'))).toBe(true);
    expect(isLocalDatabase(postgres('postgres://u:p@[::1]:5432/ledger'))).toBe(true);
    expect(isLocalDatabase(postgres('postgres://u:p@db.localhost:5432/ledger'))).toBe(true);
  });

  it('is not a service by any other name, nor a URL that cannot be read', () => {
    expect(isLocalDatabase(sqld('http://sqld:8080'))).toBe(false);
    expect(isLocalDatabase(postgres('postgres://u:p@db.example.com:5432/ledger'))).toBe(false);
    expect(isLocalDatabase(postgres('postgres://u:p@10.0.0.5:5432/ledger'))).toBe(false);
    expect(isLocalDatabase(postgres('postgres://u:p@localhost.example.com:5432/ledger'))).toBe(
      false,
    );
    expect(isLocalDatabase(postgres('postgres://u:p@evil-localhost:5432/ledger'))).toBe(false);
    expect(isLocalDatabase(sqld('not a url'))).toBe(false);
    expect(isLocalDatabase(postgres(''))).toBe(false);
  });
});
