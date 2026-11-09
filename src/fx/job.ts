import type { Config } from '../config';
import type { Database } from '../db/client';
import type { JobDefinition } from '../jobs/runner';
import { fetchRates } from './rates';

/**
 * How long after one fetch ends the next begins. Frankfurter publishes once a working day, so this is not about freshness: it is how soon a currency a
 * person has just started to use gets its first rate. A repeat fetch costs one small request and stores nothing new, since a row is one per currency
 * and day, so any process may run it at any time and no claim is needed (DESIGN.md §9.2).
 */
export const FETCH_RATES_EVERY_MS = 3 * 60 * 60 * 1000;

export interface FetchRatesJobDeps {
  readonly fx: Config['fx'];
  readonly database: () => Promise<Database>;
  /** Replaceable so that a test needs no network. */
  readonly fetch?: typeof fetch;
}

/**
 * The `fetch-rates` job (task 3.3). Runs at start, so that a fresh instance whose first person has added a currency has rates without waiting, and an instance
 * that uses no currency but USD makes no request at all. With `LEDGER_FX=off` there is no job: `jobsFor` leaves it out.
 */
export function fetchRatesJob(deps: FetchRatesJobDeps): JobDefinition {
  return {
    name: 'fetch-rates',
    everyMs: FETCH_RATES_EVERY_MS,
    runAtStart: true,
    async run({ now, signal }) {
      await fetchRates(await deps.database(), {
        now,
        signal,
        ...(deps.fx.url === undefined ? {} : { url: deps.fx.url }),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
    },
  };
}
