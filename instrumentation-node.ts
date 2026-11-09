import { loadConfig } from './src/config';
import { processEnv } from './src/config/env';

/**
 * Brings the server up, or stops it. The standalone server would otherwise stay up and answer, and an instance would find the mistake from a
 * person using it:
 *
 * 1. The settings are checked, and a wrong one stops the server, naming it.
 * 2. The database is provisioned, opened and migrated (DESIGN.md §18.1), and the server does not start if it cannot. It waits for one that is
 *    still starting, up to LEDGER_DB_CONNECT_TIMEOUT_MS, since in a compose file the app and its database come up together.
 * 3. The background jobs start, unless `LEDGER_WORKER=off` (src/jobs), and stop when the process is told to (SIGTERM, which Docker sends).
 */
export async function start(): Promise<void> {
  const result = loadConfig(processEnv());
  if (!result.ok) {
    console.error('Ledger cannot start, because of its settings:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  try {
    const { getStores } = await import('./src/db/boot');
    await getStores(result.config.database);
  } catch (error) {
    console.error('Ledger cannot start, because its database is not usable:');
    console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const { jobsFor, startJobs } = await import('./src/jobs');
  const runner = startJobs(result.config, jobsFor(result.config));
  if (runner) {
    // Next's own handler closes the server and exits with the signal's code; this one stops the timers at once and gives a run in flight a
    // moment, which it may not use up if Next finishes first: a run cut off is safe, because every job claims its work (src/jobs/claim.ts).
    const stop = () => void runner.stop();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }
}
