import type { Database } from '../db/client';
import type { JobDefinition } from '../jobs/runner';
import { postDue } from './recurring';

/** How long after a run ends the next begins: an hour, so a bill falls due within the hour of its day in its book's own zone (DESIGN.md §8.2). */
export const POST_RECURRING_EVERY_MS = 60 * 60 * 1000;

/**
 * The `post-recurring` job (task 6.2): posts the entries in mode `auto` that have fallen due, catching up what a stopped server missed. **It claims its work in
 * the database** (`postOccurrence`), so it is safe to run twice and from two processes: the occurrence is posted once. It runs at start, so that a server that was
 * down posts what it missed as soon as it is up. A log line says only how many could not be posted, never what they were.
 */
export function postRecurringJob(deps: { database: () => Promise<Database> }): JobDefinition {
  return {
    name: 'post-recurring',
    everyMs: POST_RECURRING_EVERY_MS,
    runAtStart: true,
    async run({ now }) {
      const result = await postDue(await deps.database(), now);
      if (result.failed > 0)
        console.warn(
          `[ledger] post-recurring: ${result.failed} recurring ${result.failed === 1 ? 'entry' : 'entries'} could not be posted`,
        );
    },
  };
}
