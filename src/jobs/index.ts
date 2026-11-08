import type { Config } from '../config';
import { JobRunner, realDeps, type JobDefinition, type RunnerDeps } from './runner';

/**
 * Every job the app has. Each task that has one adds it here: the exchange-rate fetch (3.3), the recurring entries (6.2) and the recap (8.6).
 * Each claims its work with a conditional update (`claim.ts`), so any process may run it at any time and one does the work.
 */
export const jobs: readonly JobDefinition[] = [];

/**
 * Starts the jobs, or says why not. `LEDGER_WORKER=off` runs nothing in this process: when several share a database, one runs the jobs and the
 * others only serve (DESIGN.md §5). Returns the runner, so that the server can stop it.
 */
export function startJobs(
  config: Pick<Config, 'worker'>,
  definitions: readonly JobDefinition[] = jobs,
  deps: RunnerDeps = realDeps,
): JobRunner | undefined {
  if (!config.worker) {
    deps.log('[ledger] jobs: off in this process (LEDGER_WORKER=off)');
    return undefined;
  }
  const runner = new JobRunner(deps);
  for (const job of definitions) runner.register(job);
  runner.start();
  deps.log(
    `[ledger] jobs: running ${definitions.length} job${definitions.length === 1 ? '' : 's'}`,
  );
  return runner;
}
