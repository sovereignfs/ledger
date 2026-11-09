import { createSovereign } from '@sovereignfs/sdk';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { smtpMailer } from '../mail/smtp';
import { emailOfAccount, subOfAccount } from '../sovereign/identity';
import { bookRecapOn } from './recap-setting';
import {
  type Channel,
  type Result,
  activityLogger,
  coreChannel,
  coreEmailChannel,
  emailChannel,
} from './channels';

/**
 * The channels this server has (DESIGN.md §13.4): **core's bell and email** where the people sign in through a core, and **the app's own mail** where there is mail. A channel is
 * here only where it can work, and with none this is empty, which is how the jobs that send know there is nothing to claim: turning one on later does not send what was waiting.
 * Both need the address people use, since a notice links to the app. The bell and the email through core are one SDK client, the app as itself, which holds no person's token
 * and needs no store of one.
 */
export interface Notifier {
  readonly channels: readonly Channel[];
  /** A line on the person's activity page at core, for what the app did for them; a no-op with no core. */
  readonly activity: (entry: {
    accountId: string;
    summary: string;
    path: string;
    key: string;
  }) => Promise<Result>;
}

const NONE: Result = { outcome: 'no_channel' };

export function serverNotifier(
  config: Pick<Config, 'url' | 'auth' | 'mail'>,
  databases: { app: Database; auth: Database },
  log: (line: string) => void,
): Notifier {
  const url = config.url;
  if (!url) return { channels: [], activity: async () => NONE };
  const absolute = (path: string) => `${url}${path}`;
  const channels: Channel[] = [];
  // Whether the person wants the recap by email: the book's own setting, which is the only one there is.
  const wantsRecap = (accountId: string) => bookRecapOn(databases.app, accountId);
  let activity: Notifier['activity'] = async () => NONE;
  const core = config.auth?.sovereign;
  if (core) {
    const sovereign = createSovereign({
      appUrl: url,
      coreUrl: new URL(core.issuer).origin,
      clientId: core.clientId,
      clientSecret: core.clientSecret,
    });
    const subOf = async (accountId: string) =>
      (await subOfAccount(databases.auth, accountId)) ?? undefined;
    channels.push(
      coreChannel({ sovereign: sovereign.app, subOf, absolute, now: Date.now, log }),
      coreEmailChannel({
        sovereign: sovereign.app,
        subOf,
        enabled: wantsRecap,
        absolute,
        now: Date.now,
        log,
      }),
    );
    activity = activityLogger({ sovereign: sovereign.app, subOf, absolute, now: Date.now, log });
  }
  if (config.mail) {
    channels.push(
      emailChannel({
        mailer: smtpMailer(config.mail),
        app: 'Ledger',
        addressOf: async (accountId) =>
          (await emailOfAccount(databases.auth, accountId)) ?? undefined,
        enabled: wantsRecap,
        settingsUrl: absolute('/account?section=notifications'),
        absolute,
      }),
    );
  }
  return { channels, activity };
}

let shared: Notifier | undefined;

/**
 * The notifier of this process, made once from the settings and the open stores. Only a route or a job in the running server asks for it: tests build theirs with
 * `serverNotifier` and their own databases.
 */
export async function currentNotifier(): Promise<Notifier> {
  if (shared) return shared;
  const [{ getConfig }, boot] = await Promise.all([
    import('../config/current'),
    import('../db/boot'),
  ]);
  const config = getConfig();
  shared = serverNotifier(
    config,
    {
      app: await boot.getDatabase(config.database),
      auth: await boot.getAuthDatabase(config.database),
    },
    (line) => console.info(`[ledger] ${line}`),
  );
  return shared;
}
