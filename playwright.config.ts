import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PORTS } from './e2e/ports.ts';

/**
 * Browser tests (`pnpm build && pnpm e2e`): the real app, built, in a real browser. They are where the things a unit test cannot show are shown:
 * a page as a visitor sees it, a policy a browser enforces, a service worker, and a phone's width.
 *
 * One instance of the app runs, on the database form the environment names: a leg of CI sets the variables an operator would set
 * (`LEDGER_DB_DIALECT` and its address) and this uses them as they are, and with none it is a SQLite file in a directory of its own. The three
 * forms are three runs of this, as the data-layer tests are. The journeys that change how an account signs in through a core have two instances of their own.
 *
 * Two browsers: Chromium, and WebKit, which is Safari's engine and where iOS's scrolling and compositing differ most. WebKit here is a desktop
 * build: it does not check touch, which the iOS Simulator does, by hand, and says so in the PR.
 *
 * The ports are `e2e/ports.ts`'s, shifted by `LEDGER_E2E_PORT_OFFSET`, which is how `scripts/e2e-shard.mjs` runs several of these at once.
 *
 * The secret below is for this throwaway instance only.
 */
const PORT = PORTS.app;
/**
 * Two more instances, for signing in through Sovereign, a fake one run by `e2e/fake-sovereign-server.ts` (its ports are in `e2e/ports.ts`, and a control port says who
 * the next person to sign in is): one that takes only Sovereign and only the first account, and one that takes both ways and anyone. `e2e/sovereign.spec.ts`.
 */
const SOVEREIGN_PORT = PORTS.sovereign;
const BOTH_PORT = PORTS.both;
const CORE = {
  LEDGER_CORE_URL: `http://localhost:${PORTS.coreAuth}/api/auth`,
  LEDGER_CORE_CLIENT_ID: 'ledger-e2e-client',
  LEDGER_CORE_CLIENT_SECRET: 'ledger-e2e-secret',
};
const SECRET = 'e2e-only-secret-not-for-anything-real-0123456789';
// Playwright loads this file again in every worker: the first load makes the directory and the others, which inherit the variable, use it.
const directory = process.env.LEDGER_E2E_DIR ?? mkdtempSync(join(tmpdir(), 'ledger-e2e-'));
process.env.LEDGER_E2E_DIR = directory;

// A directory of its own for each of the other instances: the auth database is `ledger_auth.db` beside the app's, so two instances in one directory would share
// their accounts, and a session cookie (which a port does not separate) would sign a person in on both.
const own = (name: string): string => {
  const folder = join(directory, name);
  mkdirSync(folder, { recursive: true });
  return join(folder, 'ledger.db');
};

// Next reads `.env.local` and does not override what is already set, so a developer's own settings there would reach this instance. Setting a
// name, even to nothing, keeps it out: an empty value is "not set" to the app.
const BLANK = Object.fromEntries(
  [
    'LEDGER_URL',
    'LEDGER_AUTH_LOCAL',
    'LEDGER_AUTH_SECRET',
    'LEDGER_AUTH_SIGNUP',
    'LEDGER_CORE_URL',
    'LEDGER_CORE_CLIENT_ID',
    'LEDGER_CORE_CLIENT_SECRET',
    'LEDGER_CORE_CLIENT_SECRET_FILE',
    'LEDGER_SMTP_HOST',
    'LEDGER_WORKER',
    'LEDGER_FX',
    'LEDGER_ENCRYPTION_KEY',
  ].map((name) => [name, '']),
);

// With no database named, a file in a directory of its own: the auth database is `ledger_auth.db` beside the app's, and a developer's data is not
// touched.
const database = process.env.LEDGER_DB_DIALECT
  ? {}
  : { LEDGER_DB_DIALECT: 'sqlite', LEDGER_SQLITE_URL: `file:${join(directory, 'ledger.db')}` };

export default defineConfig({
  testDir: 'e2e',
  // One at a time: the instance shares one database, and the tests are quick.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    // First, so that it is up when the instances that sign in through it start and discover it.
    {
      command: 'node e2e/fake-sovereign-server.ts',
      url: `http://localhost:${PORTS.coreControl}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/serve-standalone.mjs ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...BLANK,
        ...database,
        LEDGER_URL: `http://localhost:${PORT}`,
        LEDGER_AUTH_LOCAL: '1',
        LEDGER_AUTH_SECRET: SECRET,
        LEDGER_AUTH_SIGNUP: 'closed',
        // The rates are not fetched from the network by a test.
        LEDGER_FX: 'off',
      } as Record<string, string>,
    },
    {
      command: `node scripts/serve-standalone.mjs ${SOVEREIGN_PORT}`,
      url: `http://localhost:${SOVEREIGN_PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...BLANK,
        LEDGER_DB_DIALECT: 'sqlite',
        LEDGER_SQLITE_URL: `file:${own('sovereign')}`,
        LEDGER_URL: `http://localhost:${SOVEREIGN_PORT}`,
        LEDGER_AUTH_SECRET: SECRET,
        LEDGER_AUTH_SIGNUP: 'closed',
        LEDGER_FX: 'off',
        ...CORE,
      } as Record<string, string>,
    },
    {
      command: `node scripts/serve-standalone.mjs ${BOTH_PORT}`,
      url: `http://localhost:${BOTH_PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...BLANK,
        LEDGER_DB_DIALECT: 'sqlite',
        LEDGER_SQLITE_URL: `file:${own('both')}`,
        LEDGER_URL: `http://localhost:${BOTH_PORT}`,
        LEDGER_AUTH_LOCAL: '1',
        LEDGER_AUTH_SECRET: SECRET,
        LEDGER_AUTH_SIGNUP: 'open',
        LEDGER_FX: 'off',
        ...CORE,
      } as Record<string, string>,
    },
  ],
});
