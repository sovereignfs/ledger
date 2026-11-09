import type { Config } from '../config';
import { fetchRatesJob } from '../fx/job';
import { postRecurringJob } from '../recurring/job';
import { JobRunner, realDeps, type JobDefinition, type RunnerDeps } from './runner';

/**
 * Every job the app has, for these settings. Each task that has one adds it here: the recap (8.6) is to come. The exchange-rate
 * fetch (3.3) is there unless `LEDGER_FX=off`. A job claims its work with a conditional update (`claim.ts`) or is idempotent by its key, so any process may run it
 * at any time and the work is done once.
 */
export function jobsFor(config: Pick<Config, 'fx' | 'database'>): readonly JobDefinition[] {
  return [
    ...(config.fx.enabled
      ? [
          fetchRatesJob({
            fx: config.fx,
            // Loaded when the job first runs: the runner's module is imported by `instrumentation-node` after the stores are open, and a test of
            // the list needs no database.
            database: async () => (await import('../db/boot')).getDatabase(config.database),
          }),
        ]
      : []),
    // Bills that post themselves (task 6.2): always on, since they are the book's own and need no other service.
    postRecurringJob({
      database: async () => (await import('../db/boot')).getDatabase(config.database),
    }),
  ];
}

/**
 * Starts the jobs, or says why not. `LEDGER_WORKER=off` runs nothing in this process: when several share a database, one runs the jobs and the
 * others only serve (DESIGN.md §5). The jobs are `jobsFor(config)`. Returns the runner, so that the server can stop it.
 */
export function startJobs(
  config: Pick<Config, 'worker'>,
  definitions: readonly JobDefinition[],
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
