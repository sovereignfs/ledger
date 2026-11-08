import { loadConfig } from './src/config';
import { processEnv } from './src/config/env';

/**
 * Brings the server up, or stops it. The standalone server would otherwise stay up and answer, and an instance would find the mistake from a
 * person using it:
 *
 * 1. The settings are checked, and a wrong one stops the server, naming it.
 *
 * The database (task 1.5) and the background jobs (task 1.6) start after it.
 */
export async function start(): Promise<void> {
  const result = loadConfig(processEnv());
  if (!result.ok) {
    console.error('Ledger cannot start, because of its settings:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
