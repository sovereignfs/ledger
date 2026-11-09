/**
 * Every port the browser tests use, each shifted by `LEDGER_E2E_PORT_OFFSET`, so that several runs can share a machine: `scripts/e2e-shard.mjs` gives each of its
 * shards a hundred of its own, and each then has its own instances, databases and fake services. With none set they are the ports the tests have always used.
 * Plain TypeScript with no syntax Node cannot strip, since a fake service run by Node reads this too (the fake Sovereign, task 2.3).
 */
const offset = Number(process.env.LEDGER_E2E_PORT_OFFSET ?? 0);
if (!Number.isInteger(offset) || offset < 0 || offset > 20_000) {
  throw new Error('LEDGER_E2E_PORT_OFFSET must be a whole number from 0 to 20000');
}

export const PORTS = {
  /** The app under test, on the database the environment names. */
  app: 3999 + offset,
  /** The instance that takes only Sovereign, and the one that takes both ways (`e2e/sovereign.spec.ts`). */
  sovereign: 3995 + offset,
  both: 3994 + offset,
  /** The fake Sovereign: the OIDC provider, and the control port a test says who signs in next on. */
  coreAuth: 3190 + offset,
  coreControl: 3191 + offset,
} as const;
