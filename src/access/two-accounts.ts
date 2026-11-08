import { type TestAuth, type TestClient, makeAuth } from '../auth/test-support';
import type { Database } from '../db/client';
import { openStoreBesideAuth } from '../db/test-store';
import { ensureBook } from '../ledger/books';
import type { AccessDeps } from './route';

/**
 * Two accounts on one instance, for **every server test that needs to call as the wrong one** (DESIGN.md §5.2): seed what `ada` owns, then ask
 * for it as `grace`, and assert that the answer is the one for a row that is not there and that nothing changed. It makes a real auth store
 * (on whichever database the leg runs on) and real sessions, so what is tested is the same check a request meets in the server.
 *
 *   const t = await twoAccounts();
 *   const reply = await t.as(t.grace).post('/api/…', body);   // a Reply, as the auth tests read them
 *   const response = await handler(t.request(t.grace, '/api/…', { method: 'POST', body })); // a route handler, called as grace
 */
export interface Person {
  /** The account id: better-auth's user id, which is what a row's `owner_id` holds. */
  id: string;
  email: string;
  client: TestClient;
}

export interface TwoAccounts {
  auth: TestAuth;
  /** The app's store, migrated, beside the auth store the two accounts are in: a test of the data layer reads and writes the books through it. */
  database: Database;
  /** What `bookRoute` is given, to wrap a handler under test with this instance's better-auth. */
  deps: AccessDeps;
  ada: Person;
  grace: Person;
  /** A client that is a particular person's browser, to call better-auth's own endpoints. */
  as(person: Person): TestClient;
  /**
   * A request as a person's browser would send it: with their cookies and this instance's `Origin`. `person` null is a visitor with no session.
   * `headers` can change anything, `origin: ''` removing it.
   */
  request(
    person: Person | null,
    path: string,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
  ): Request;
  close(): Promise<void>;
}

const PASSWORD = 'a password long enough to be one';

export async function twoAccounts(): Promise<TwoAccounts> {
  const auth = await makeAuth({ signUp: 'open' });
  // After the accounts' store is made and reset, and not reset itself: on sqld and PostgreSQL the two stores are one database.
  const store = await openStoreBesideAuth();
  const person = async (name: string, ip: string): Promise<Person> => {
    const client = auth.client().from(ip);
    const email = `${name.toLowerCase()}@example.com`;
    const reply = await client.post('/api/auth/sign-up/email', { name, email, password: PASSWORD });
    if (reply.status !== 200) throw new Error(`could not seed ${name}: ${reply.status}`);
    return { id: reply.body.user.id as string, email, client };
  };
  const ada = await person('Ada', '198.51.100.1');
  const grace = await person('Grace', '198.51.100.2');

  return {
    auth,
    database: store.database,
    deps: {
      origin: () => auth.settings.url,
      accountOf: async (headers) => (await auth.auth.api.getSession({ headers }))?.user.id ?? null,
      bookOf: async (accountId) => (await ensureBook(store.database, accountId)).id,
    },
    ada,
    grace,
    as: (who) => who.client,
    request(who, path, init = {}) {
      const { method = 'GET', body, headers = {} } = init;
      const sent = new Headers({
        origin: auth.settings.url,
        ...(who ? { cookie: who.client.cookieHeader() } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      });
      if (sent.get('origin') === '') sent.delete('origin');
      return new Request(new URL(path, auth.settings.url), {
        method,
        headers: sent,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    },
    close: async () => {
      await store.close();
      await auth.close();
    },
  };
}
