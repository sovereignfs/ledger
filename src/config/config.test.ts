import { describe, expect, it } from 'vitest';
import { loadConfig, type LoadResult } from './index';
import { readEnvironment, readSecret } from './env';

/** The problems of a bad environment, which every test below wants to read and none expects to be empty. */
function problems(result: LoadResult): readonly string[] {
  if (result.ok) throw new Error('the settings were accepted');
  return result.problems;
}

/** What signing in needs besides a way to: the address people use and the secret the sessions are signed with. */
const SIGNED_IN = {
  LEDGER_URL: 'https://ledger.example.com',
  LEDGER_AUTH_SECRET: 'a-secret-of-at-least-thirty-two-characters',
};

describe('loadConfig', () => {
  it('accepts no settings at all: the worker and the rate fetch are on, there is no address or key, and the database is an sqld service at its default address', () => {
    expect(loadConfig({})).toMatchObject({
      ok: true,
      config: {
        url: undefined,
        worker: true,
        fx: { enabled: true, url: undefined },
        database: { database: { form: 'sqld' } },
        encryption: undefined,
      },
    });
  });

  it('reports a wrong database setting with the others, naming it', () => {
    const [problem] = problems(loadConfig({ LEDGER_DB_DIALECT: 'mysql' }));
    expect(problem).toContain('LEDGER_DB_DIALECT');
  });

  it('reads the PostgreSQL address from a file, and keeps it out of what it reports', () => {
    const result = loadConfig(
      { LEDGER_DB_DIALECT: 'postgres', LEDGER_POSTGRES_URL_FILE: '/run/db' },
      () => 'postgres://u:hunter2@db:5432/ledger\n',
    );
    expect(result).toMatchObject({ ok: true });
    const bad = problems(
      loadConfig(
        { LEDGER_DB_DIALECT: 'postgres', LEDGER_POSTGRES_URL_FILE: '/run/db' },
        () => 'hunter2 is not a url',
      ),
    );
    expect(bad.join(' ')).not.toContain('hunter2');
  });

  describe('LEDGER_URL', () => {
    it('keeps the origin of an https address', () => {
      expect(loadConfig({ LEDGER_URL: 'https://ledger.example.com/' })).toMatchObject({
        ok: true,
        config: { url: 'https://ledger.example.com' },
      });
    });

    it.each([
      'http://localhost:3003',
      'http://127.0.0.1:3003',
      'http://[::1]:3003',
      'http://x.localhost',
    ])('allows plain http on this machine: %s', (url) => {
      expect(loadConfig({ LEDGER_URL: url }).ok).toBe(true);
    });

    it('refuses plain http anywhere else, naming the setting and not the value', () => {
      const [problem] = problems(loadConfig({ LEDGER_URL: 'http://ledger.example.com' }));
      expect(problem).toContain('LEDGER_URL');
      expect(problem).not.toContain('ledger.example.com');
    });

    it.each([
      ['not an address', 'not-an-address-value'],
      ['another scheme', 'ftp://ledger.example.com'],
      ['a path', 'https://ledger.example.com/app'],
      ['a query', 'https://ledger.example.com/?a=1'],
      ['a user name', 'https://me:secret@ledger.example.com'],
    ])('refuses %s, and never prints it', (_what, url) => {
      const result = problems(loadConfig({ LEDGER_URL: url }));
      expect(result.join(' ')).toContain('LEDGER_URL');
      expect(result.join(' ')).not.toContain('secret');
      expect(result.join(' ')).not.toContain(url);
    });
  });

  describe('LEDGER_WORKER', () => {
    it('is on unless it says off', () => {
      expect(loadConfig({ LEDGER_WORKER: 'off' })).toMatchObject({ config: { worker: false } });
      expect(loadConfig({ LEDGER_WORKER: 'on' })).toMatchObject({ config: { worker: true } });
    });

    it('refuses anything else', () => {
      expect(problems(loadConfig({ LEDGER_WORKER: 'yes' }))[0]).toContain('LEDGER_WORKER');
    });
  });

  describe('the exchange-rate fetch', () => {
    it('is on unless LEDGER_FX says off, and from Frankfurter unless LEDGER_FX_URL names a mirror', () => {
      expect(loadConfig({ LEDGER_FX: 'off' })).toMatchObject({
        config: { fx: { enabled: false } },
      });
      expect(loadConfig({ LEDGER_FX_URL: 'https://mirror.example.com/v1/' })).toMatchObject({
        config: { fx: { enabled: true, url: 'https://mirror.example.com/v1' } },
      });
      expect(loadConfig({ LEDGER_FX_URL: 'http://localhost:4010' }).ok).toBe(true);
    });

    it.each([
      ['LEDGER_FX', 'maybe'],
      ['LEDGER_FX_URL', 'http://mirror.example.com'],
      ['LEDGER_FX_URL', 'https://user:pass@mirror.example.com'],
      ['LEDGER_FX_URL', 'https://mirror.example.com?key=1'],
      ['LEDGER_FX_URL', 'mirror-host'],
    ])('stops on %s=%s, naming the setting and not the value', (name, value) => {
      const said = problems(loadConfig({ [name]: value })).join(' ');
      expect(said).toContain(name);
      expect(said).not.toContain(value);
    });
  });

  describe('settings that go together', () => {
    it.each(['LEDGER_CORE_URL', 'LEDGER_CORE_CLIENT_ID'])('stops on %s given alone', (name) => {
      const [problem] = problems(loadConfig({ [name]: 'value-that-must-not-appear' }));
      expect(problem).toContain('Sovereign sign-in');
      expect(problem).not.toContain('value-that-must-not-appear');
    });

    it('names what is missing', () => {
      const [problem] = problems(
        loadConfig({ LEDGER_CORE_URL: 'https://core.example.com', LEDGER_CORE_CLIENT_ID: 'a' }),
      );
      expect(problem).toContain('LEDGER_CORE_CLIENT_SECRET is missing');
    });

    it('accepts all of a group, and counts a secret given as a file as given', () => {
      const files: Record<string, string> = { '/run/secret': 's3cret\n' };
      expect(
        loadConfig(
          {
            ...SIGNED_IN,
            LEDGER_CORE_URL: 'https://core.example.com',
            LEDGER_CORE_CLIENT_ID: 'a',
            LEDGER_CORE_CLIENT_SECRET_FILE: '/run/secret',
          },
          (path) => files[path] ?? '',
        ).ok,
      ).toBe(true);
    });
  });

  describe('the instance key', () => {
    const key = Buffer.alloc(32, 7);
    const other = Buffer.alloc(32, 9);
    const ringOf = (result: LoadResult) => (result.ok ? result.config.encryption : undefined);

    it('is optional: with none there is no ring, and nothing is wrong', () => {
      const result = loadConfig({});
      expect(result.ok && result.config.encryption).toBeUndefined();
    });

    it('is read in base64, URL-safe base64 and hex, from the setting or its file, and known by a fingerprint', () => {
      for (const text of [key.toString('base64'), key.toString('base64url'), key.toString('hex')]) {
        const ring = ringOf(loadConfig({ LEDGER_ENCRYPTION_KEY: text }));
        expect(ring?.current.key.equals(key), text).toBe(true);
        expect(ring?.current.fingerprint).toMatch(/^[0-9a-f]{16}$/);
        expect(ring?.previous).toBeUndefined();
      }
      const fromFile = ringOf(
        loadConfig({ LEDGER_ENCRYPTION_KEY_FILE: '/run/key' }, () => `${key.toString('base64')}\n`),
      );
      expect(fromFile?.current.key.equals(key)).toBe(true);
    });

    it('may have the key it replaces beside it', () => {
      const ring = ringOf(
        loadConfig({
          LEDGER_ENCRYPTION_KEY: key.toString('hex'),
          LEDGER_ENCRYPTION_KEY_PREVIOUS: other.toString('hex'),
        }),
      );
      expect(ring?.current.key.equals(key)).toBe(true);
      expect(ring?.previous?.key.equals(other)).toBe(true);
      expect(ring?.previous?.fingerprint).not.toBe(ring?.current.fingerprint);
    });

    it('stops the server for a key that is not one, a previous key with no current one, and the same key twice, never printing a value', () => {
      const secret = 'hunter2-NOT-A-KEY';
      const wrong = problems(loadConfig({ LEDGER_ENCRYPTION_KEY: secret }));
      expect(wrong.join(' ')).toContain('LEDGER_ENCRYPTION_KEY is not a key');
      expect(
        problems(loadConfig({ LEDGER_ENCRYPTION_KEY: Buffer.alloc(16).toString('hex') })).join(' '),
      ).toContain('not a key');
      const badPrevious = problems(
        loadConfig({
          LEDGER_ENCRYPTION_KEY: key.toString('hex'),
          LEDGER_ENCRYPTION_KEY_PREVIOUS: secret,
        }),
      );
      expect(badPrevious.join(' ')).toContain('LEDGER_ENCRYPTION_KEY_PREVIOUS is not a key');
      expect(
        problems(loadConfig({ LEDGER_ENCRYPTION_KEY_PREVIOUS: key.toString('hex') })).join(' '),
      ).toContain('no LEDGER_ENCRYPTION_KEY to move');
      expect(
        problems(
          loadConfig({
            LEDGER_ENCRYPTION_KEY: key.toString('hex'),
            LEDGER_ENCRYPTION_KEY_PREVIOUS: key.toString('base64'),
          }),
        ).join(' '),
      ).toContain('the same key');
      for (const message of [...wrong, ...badPrevious]) expect(message).not.toContain(secret);
    });
  });

  it('reports every problem at once, so that one run fixes them all', () => {
    expect(
      problems(loadConfig({ LEDGER_URL: 'ledger', LEDGER_WORKER: 'x', LEDGER_CORE_URL: 'k' })),
    ).toHaveLength(3);
  });

  it('turns an unreadable secret file into a problem that names the variable and not the path', () => {
    const result = problems(
      loadConfig({ LEDGER_AUTH_SECRET_FILE: '/run/secrets/nowhere' }, () => {
        throw new Error('ENOENT /run/secrets/nowhere');
      }),
    );
    expect(result.join(' ')).toContain('LEDGER_AUTH_SECRET_FILE');
    expect(result.join(' ')).not.toContain('/run/secrets/nowhere');
  });
});

describe('reading the environment', () => {
  const read = (env: Record<string, string | undefined>, name: string, readFile?: () => string) => {
    const reading = readEnvironment(env, readFile);
    if (!reading.ok) throw new Error(reading.problems.join(' '));
    return reading.read(name);
  };

  it('reads the plain name', () => {
    expect(read({ LEDGER_URL: 'a' }, 'LEDGER_URL')).toBe('a');
  });

  it('reads a secret from its file, trimmed', () => {
    expect(
      read({ LEDGER_AUTH_SECRET_FILE: '/run/s' }, 'LEDGER_AUTH_SECRET', () => 's3cret\n'),
    ).toBe('s3cret');
  });

  it('refuses a secret given both ways, and a file for a setting that is not a secret', () => {
    const both = readEnvironment({ LEDGER_AUTH_SECRET: 'a', LEDGER_AUTH_SECRET_FILE: '/x' });
    expect(both.ok).toBe(false);
    const text = readEnvironment({ LEDGER_URL_FILE: '/x' });
    expect(text).toMatchObject({ ok: false });
    expect(text.ok ? '' : text.problems.join(' ')).toContain('LEDGER_URL_FILE');
  });

  it('treats a blank value as not given', () => {
    expect(read({ LEDGER_URL: '   ' }, 'LEDGER_URL')).toBeUndefined();
  });

  it('readSecret reads one secret alone', () => {
    expect(readSecret({ LEDGER_ENCRYPTION_KEY: 'k' }, 'LEDGER_ENCRYPTION_KEY')).toBe('k');
  });
});
