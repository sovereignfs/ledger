import type { Database } from '../db/client';
import type { JobDefinition } from '../jobs/runner';
import { contributeDue } from './contributions';

/** An hour, so a contribution is made within the hour of the 1st in its book's own zone (DESIGN.md §10.2). */
export const CONTRIBUTE_EVERY_MS = 60 * 60 * 1000;

/**
 * The `contribute-jars` job (task 7.2): earmarks each jar's monthly contribution once a month. **It is safe to run twice and from two processes**: the movement
 * carries the month and `(jar_id, month)` is unique. It runs at start, so a server that was down on the 1st makes it as soon as it is up. A log line says only
 * how many were skipped, never which.
 */
export function contributeJarsJob(deps: { database: () => Promise<Database> }): JobDefinition {
  return {
    name: 'contribute-jars',
    everyMs: CONTRIBUTE_EVERY_MS,
    runAtStart: true,
    async run({ now }) {
      const result = await contributeDue(await deps.database(), now);
      if (result.skipped > 0)
        console.warn(
          `[ledger] contribute-jars: ${result.skipped} ${result.skipped === 1 ? 'contribution' : 'contributions'} did not fit and ${result.skipped === 1 ? 'was' : 'were'} skipped`,
        );
    },
  };
}
