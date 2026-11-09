import { authSettings } from '../auth/server';
import { getAuthDatabase, getDatabase } from '../db/boot';
import { RateLimiter } from '../limits/rate';
import type { NoticeDeps } from './http';
import { accountOfSub, endSessionsOf } from './identity';
import { deletePerson } from './people';
import { sdkVerifiers, seenBy } from './verifiers';

/**
 * What the routes for Sovereign's notices are handed (`http.ts`): the SDK's verifiers for this instance's settings, the people to act on, and the limit on how
 * many requests are taken. Undefined when Sovereign sign-in is not set up, when there is nothing to hear from, and the routes answer 404. Never for a test,
 * which makes its own.
 */
const KEY = Symbol.for('ledger.sovereign-notices');
type Holder = { [KEY]?: Promise<NoticeDeps | undefined> };

export function noticeDeps(): Promise<NoticeDeps | undefined> {
  const store = globalThis as Holder;
  // Made once, so that the limiter's counts are one process's and its sweep of old rows runs.
  store[KEY] ??= make();
  return store[KEY];
}

async function make(): Promise<NoticeDeps | undefined> {
  const sovereign = authSettings()?.sovereign;
  if (!sovereign) return undefined;
  const database = await getDatabase();
  const authDatabase = await getAuthDatabase();
  const limiter = new RateLimiter(database);
  return {
    verify: sdkVerifiers({
      coreUrl: sovereign.issuer,
      clientId: sovereign.clientId,
      seen: seenBy(limiter),
    }),
    people: {
      endSessions: async (sub) => {
        const accountId = await accountOfSub(authDatabase, sub);
        return accountId === null ? 0 : endSessionsOf(authDatabase, accountId);
      },
      deletePerson: async (sub) => {
        // A person nobody here knows (never signed in, or already deleted: core sends a deletion until it is answered) is done, and answered 200.
        const accountId = await accountOfSub(authDatabase, sub);
        if (accountId !== null)
          await deletePerson({ database, authDatabase, now: Date.now }, accountId);
      },
    },
    limiter,
    log: (line) => console.error(line),
  };
}
