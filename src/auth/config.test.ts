import { describe, expect, it } from 'vitest';
import { loadConfig, type LoadResult } from '../config';

const SECRET = 'a-secret-that-is-at-least-thirty-two-characters-long';
const ON = {
  LEDGER_URL: 'https://ledger.example.com',
  LEDGER_AUTH_LOCAL: '1',
  LEDGER_AUTH_SECRET: SECRET,
};

function problems(result: LoadResult): readonly string[] {
  if (result.ok) throw new Error('the settings were accepted');
  return result.problems;
}

function authOf(result: LoadResult) {
  if (!result.ok) throw new Error(result.problems.join(' '));
  return result.config.auth;
}

const CORE = {
  LEDGER_CORE_URL: 'https://sovereign.example.com',
  LEDGER_CORE_CLIENT_ID: 'ledger-client',
  LEDGER_CORE_CLIENT_SECRET: 'ledger-client-secret',
};

describe('sign-in settings', () => {
  it('are off when local sign-in is not asked for, and then nothing else of them is read', () => {
    expect(authOf(loadConfig({}))).toBeUndefined();
    expect(
      authOf(loadConfig({ LEDGER_AUTH_LOCAL: '0', LEDGER_AUTH_SECRET: 'short' })),
    ).toBeUndefined();
    expect(authOf(loadConfig({ LEDGER_AUTH_LOCAL: 'false' }))).toBeUndefined();
  });

  it('are on with an address and a secret, and sign-up is closed unless it is said to be open', () => {
    expect(authOf(loadConfig(ON))).toEqual({
      url: 'https://ledger.example.com',
      secret: SECRET,
      signUp: 'closed',
      passwordMinLength: 10,
      local: true,
      sovereign: undefined,
    });
    expect(
      authOf(loadConfig({ ...ON, LEDGER_AUTH_LOCAL: 'true', LEDGER_AUTH_SIGNUP: 'OPEN' })),
    ).toMatchObject({
      signUp: 'open',
    });
    expect(authOf(loadConfig({ ...ON, LEDGER_AUTH_PASSWORD_MIN_LENGTH: '14' }))).toMatchObject({
      passwordMinLength: 14,
    });
  });

  it('read the secret from a file, and keep it out of what they report', () => {
    const result = loadConfig(
      { ...ON, LEDGER_AUTH_SECRET: undefined, LEDGER_AUTH_SECRET_FILE: '/run/secret' },
      () => `${SECRET}\n`,
    );
    expect(authOf(result)).toMatchObject({ secret: SECRET });
    const short = problems(loadConfig({ ...ON, LEDGER_AUTH_SECRET: 'hunter2' })).join(' ');
    expect(short).toContain('LEDGER_AUTH_SECRET');
    expect(short).not.toContain('hunter2');
  });

  it('stop the server when a way is on and a thing it needs is missing or wrong', () => {
    expect(problems(loadConfig({ ...ON, LEDGER_AUTH_SECRET: undefined })).join(' ')).toContain(
      'LEDGER_AUTH_SECRET',
    );
    expect(problems(loadConfig({ ...ON, LEDGER_URL: undefined })).join(' ')).toContain(
      'LEDGER_URL',
    );
    expect(problems(loadConfig({ ...ON, LEDGER_AUTH_SIGNUP: 'anyone' })).join(' ')).toContain(
      'LEDGER_AUTH_SIGNUP',
    );
    expect(problems(loadConfig({ ...ON, LEDGER_AUTH_LOCAL: 'yes' })).join(' ')).toContain(
      'LEDGER_AUTH_LOCAL',
    );
    for (const bad of ['3', '1000', 'ten'])
      expect(
        problems(loadConfig({ ...ON, LEDGER_AUTH_PASSWORD_MIN_LENGTH: bad })).join(' '),
      ).toContain('LEDGER_AUTH_PASSWORD_MIN_LENGTH');
  });

  it('open sign-up by default only when a core is the only way in, and keep what the operator says either way', () => {
    const coreOnly = { LEDGER_URL: ON.LEDGER_URL, LEDGER_AUTH_SECRET: SECRET, ...CORE };
    expect(authOf(loadConfig(coreOnly))?.signUp).toBe('open');
    expect(authOf(loadConfig({ ...coreOnly, LEDGER_AUTH_SIGNUP: 'closed' }))?.signUp).toBe(
      'closed',
    );
    expect(authOf(loadConfig({ ...coreOnly, LEDGER_AUTH_LOCAL: '1' }))?.signUp).toBe('closed');
    expect(authOf(loadConfig(ON))?.signUp).toBe('closed');
  });

  it('say about a wrong address only once: the address check already reported it', () => {
    const reported = problems(loadConfig({ ...ON, LEDGER_URL: 'http://ledger.example.com' }));
    expect(reported.filter((problem) => problem.includes('LEDGER_URL'))).toHaveLength(1);
  });

  it('are on with a core alone: Sovereign sign-in with no password, still needing an address and a secret', () => {
    const only = { LEDGER_URL: ON.LEDGER_URL, LEDGER_AUTH_SECRET: SECRET, ...CORE };
    expect(authOf(loadConfig(only))).toEqual({
      url: 'https://ledger.example.com',
      secret: SECRET,
      // A core alone decides who may sign in, so sign-up is open unless the operator closes it.
      signUp: 'open',
      passwordMinLength: 10,
      local: false,
      sovereign: {
        issuer: 'https://sovereign.example.com',
        clientId: 'ledger-client',
        clientSecret: 'ledger-client-secret',
      },
    });
    expect(authOf(loadConfig({ ...only, LEDGER_AUTH_LOCAL: '1' }))).toMatchObject({
      local: true,
      sovereign: { clientId: 'ledger-client' },
    });
    expect(authOf(loadConfig(ON))).toMatchObject({ local: true, sovereign: undefined });
    expect(problems(loadConfig({ ...CORE, LEDGER_AUTH_SECRET: SECRET })).join(' ')).toContain(
      'Sovereign sign-in is set, so LEDGER_URL',
    );
    expect(problems(loadConfig({ ...CORE, LEDGER_URL: ON.LEDGER_URL })).join(' ')).toContain(
      'LEDGER_AUTH_SECRET',
    );
  });

  it('read the client secret from a file, and keep it out of what they report', () => {
    const result = loadConfig(
      {
        ...ON,
        ...CORE,
        LEDGER_CORE_CLIENT_SECRET: undefined,
        LEDGER_CORE_CLIENT_SECRET_FILE: '/s',
      },
      () => 'from-a-file\n',
    );
    expect(authOf(result)).toMatchObject({ sovereign: { clientSecret: 'from-a-file' } });
  });

  it('stop the server on a partial set of core settings, and on a core address that would send the secret in the clear', () => {
    for (const missing of Object.keys(CORE)) {
      const partial = { ...ON, ...CORE, [missing]: undefined };
      expect(problems(loadConfig(partial)).join(' ')).toContain(missing);
    }
    const insecure = problems(
      loadConfig({ ...ON, ...CORE, LEDGER_CORE_URL: 'http://sovereign.example.com' }),
    ).join(' ');
    expect(insecure).toContain('LEDGER_CORE_URL must be https');
    expect(insecure).not.toContain('ledger-client-secret');
    // Plain http is for this machine alone, and a path is kept (an issuer may have one) but not a trailing slash.
    expect(
      authOf(loadConfig({ ...ON, ...CORE, LEDGER_CORE_URL: 'http://localhost:4000/' })),
    ).toMatchObject({
      sovereign: { issuer: 'http://localhost:4000' },
    });
    expect(
      authOf(loadConfig({ ...ON, ...CORE, LEDGER_CORE_URL: 'https://core.example.com/api/auth/' })),
    ).toMatchObject({ sovereign: { issuer: 'https://core.example.com/api/auth' } });
    for (const bad of [
      'not an address',
      'https://core.example.com/?x=1',
      'https://u:p@core.example.com',
    ])
      expect(problems(loadConfig({ ...ON, ...CORE, LEDGER_CORE_URL: bad })).join(' ')).toContain(
        'LEDGER_CORE_URL',
      );
  });
});
