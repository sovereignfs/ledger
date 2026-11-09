import {
  CoreApiError,
  CoreUnavailableError,
  NotSupportedError,
  type Sovereign,
} from '@sovereignfs/sdk';
import type { Mailer } from '../mail/mailer';
import { notificationMessage } from '../mail/templates';

/**
 * Where a notice of Ledger's goes (DESIGN.md §13.4, task 10.1): each channel is one object with `send(notice)`, which answers what became of it as one of five
 * words and never throws, and `fanOut` runs every channel at once with `Promise.allSettled`, so that **one channel failing leaves the others working**.
 *
 * **What is in no log:** a title, a body, an address or a `sub`. A log line says the channel, the kind of notice and the outcome, and nothing of whom it was for.
 *
 * - `sent`           handed on: delivered to the channel, which does not say whether the person got it.
 * - `no_channel`     this person has nothing on it: no address, no linked core account, the switch off, or the channel is resting (below).
 * - `retry_after`    the channel asked to be tried later, and says in how many seconds.
 * - `not_permitted`  the channel refused this app (core without the scope, or a core too old for it).
 * - `failed`         it did not go: the channel was down, timed out or lost the answer. A notice is never sent a second time on a lost answer.
 */
export type Outcome = 'sent' | 'no_channel' | 'retry_after' | 'not_permitted' | 'failed';

export interface Result {
  readonly outcome: Outcome;
  /** For `retry_after`: how long to wait, in seconds. */
  readonly retryAfterSeconds?: number;
}

/** What a channel is given: one thing to tell one person. The text is already as long as it may be and has no markup. */
export interface Outgoing {
  readonly accountId: string;
  /** The kind of notice it is (`upcoming`, `insight`, `recap`): what a log may say. */
  readonly kind: string;
  readonly title: string;
  readonly body?: string;
  /** Where choosing it goes, as a path of this app (`/`); a channel makes it an address if it needs one. */
  readonly path: string;
  /** Names this notice, so that a channel that can drop a repeat does. */
  readonly key: string;
  /**
   * What an email says, for a notice that is also one: its subject and its text, with no markup. A bell with no `email` is never emailed, and the email channels send only what
   * has one (the recap is, the daily count of bills is not).
   */
  readonly email?: { readonly subject: string; readonly text: string };
}

export interface Channel {
  /** `email`, `core` or `push`: what a log may say. */
  readonly name: string;
  send(notice: Outgoing): Promise<Result>;
}

export type Log = (line: string) => void;

/** Runs every channel at once, and answers each one's result by name. A channel that throws, which none should, is `failed`: the others are not held up. */
export async function fanOut(
  channels: readonly Channel[],
  notice: Outgoing,
  log: Log = () => undefined,
): Promise<Record<string, Result>> {
  const settled = await Promise.allSettled(channels.map((channel) => channel.send(notice)));
  const out: Record<string, Result> = {};
  settled.forEach((each, index) => {
    const name = channels[index]?.name ?? 'unknown';
    out[name] = each.status === 'fulfilled' ? each.value : { outcome: 'failed' };
    log(`notification ${notice.kind}: ${name} ${out[name]?.outcome}`);
  });
  return out;
}

const cut = (text: string, most: number): string =>
  text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`;

/**
 * **Email**, through `src/mail/`: only a notice that is one (`email`), and only to a person who wants it (`enabled`: the recap is on) and has an address, with a message that links to Settings to turn it off.
 * It has no address of the person's own beyond the one it is given for this send, and keeps none.
 */
export function emailChannel(deps: {
  mailer: Mailer;
  app: string;
  /** The account's address, or none. */
  addressOf(accountId: string): Promise<string | undefined>;
  /** Whether the account turned email on. */
  enabled(accountId: string): Promise<boolean>;
  /** Where the person turns it off, as a whole address. */
  settingsUrl: string;
  /** Makes a path of this app a whole address. */
  absolute(path: string): string;
}): Channel {
  return {
    name: 'email',
    async send(notice) {
      try {
        // A notice that is not also an email is the bell's alone.
        if (!notice.email) return { outcome: 'no_channel' };
        if (!(await deps.enabled(notice.accountId))) return { outcome: 'no_channel' };
        const to = await deps.addressOf(notice.accountId);
        if (!to) return { outcome: 'no_channel' };
        await deps.mailer.send(
          notificationMessage(
            deps.app,
            to,
            notice.email.subject,
            notice.email.text,
            deps.absolute(notice.path),
            deps.settingsUrl,
          ),
        );
        return { outcome: 'sent' };
      } catch {
        return { outcome: 'failed' };
      }
    },
  };
}

/** How long a core that refused this app, or is too old for it, is left alone before one more try. */
export const CORE_REST_MS = 6 * 60 * 60 * 1000;

/**
 * **Core's bell**, when hosted: `sv.app.notifications.send` to the person's `sub`. **`sv.app` is the app as itself** (the SDK's `AppClient`): it asks core for a token
 * for the app and holds no person's token and no session, so it needs neither a token store nor a session store; the client is made from the four settings alone
 * (checked in the SDK's types and its fake core, where `createSovereign` takes both stores as optional and `app` is documented to "never hold a person's token").
 * Text is cut to core's limits (a title of 120, a body of 500).
 *
 * A core that refuses (`notifications:send` not granted, 403) or that does not serve notifications (too old, `NotSupportedError`) **is logged once and then rested for
 * `CORE_REST_MS`**: a channel that cannot work is tried rarely, and does not fill a log.
 */
export function coreChannel(deps: {
  sovereign: Pick<Sovereign['app'], 'notifications'>;
  /** The person's `sub` on the core, or none when they signed in another way. */
  subOf(accountId: string): Promise<string | undefined>;
  absolute(path: string): string;
  now(): number;
  log?: Log;
}): Channel {
  let restUntil = 0;
  const rest = (why: string) => {
    if (deps.now() >= restUntil) deps.log?.(`notification channel core: ${why}; resting`);
    restUntil = deps.now() + CORE_REST_MS;
  };
  return {
    name: 'core',
    async send(notice) {
      if (deps.now() < restUntil) return { outcome: 'no_channel' };
      try {
        const sub = await deps.subOf(notice.accountId);
        if (!sub) return { outcome: 'no_channel' };
        await deps.sovereign.notifications.send({
          to: sub,
          title: cut(notice.title, 120),
          ...(notice.body ? { body: cut(notice.body, 500) } : {}),
          url: deps.absolute(notice.path),
          category: 'info',
          key: notice.key,
        });
        return { outcome: 'sent' };
      } catch (error) {
        if (error instanceof NotSupportedError) {
          rest('this core does not serve notifications');
          return { outcome: 'no_channel' };
        }
        if (error instanceof CoreApiError) {
          if (error.status === 403) {
            rest('this app may not send notifications');
            return { outcome: 'not_permitted' };
          }
          if (error.status === 429)
            return {
              outcome: 'retry_after',
              ...(error.retryAfter !== undefined ? { retryAfterSeconds: error.retryAfter } : {}),
            };
          return { outcome: 'failed' };
        }
        if (error instanceof CoreUnavailableError) return { outcome: 'failed' };
        return { outcome: 'failed' };
      }
    },
  };
}

/**
 * **Core's email**, when hosted: `sv.app.email.sendToUser` to the person's `sub`, in the instance's own template and with no address of the person's given to the app. Only a
 * notice that is also an email (`email`), and only for a person who wants it (`enabled`). It rests as the bell does when core refuses the app or has no email (`email` is not
 * listed by an instance without mail, which raises `NotSupportedError` without sending).
 */
export function coreEmailChannel(deps: {
  sovereign: Pick<Sovereign['app'], 'email'>;
  subOf(accountId: string): Promise<string | undefined>;
  enabled(accountId: string): Promise<boolean>;
  absolute(path: string): string;
  now(): number;
  log?: Log;
}): Channel {
  let restUntil = 0;
  const rest = (why: string) => {
    if (deps.now() >= restUntil) deps.log?.(`notification channel core-email: ${why}; resting`);
    restUntil = deps.now() + CORE_REST_MS;
  };
  return {
    name: 'core-email',
    async send(notice) {
      if (!notice.email || deps.now() < restUntil) return { outcome: 'no_channel' };
      try {
        if (!(await deps.enabled(notice.accountId))) return { outcome: 'no_channel' };
        const sub = await deps.subOf(notice.accountId);
        if (!sub) return { outcome: 'no_channel' };
        await deps.sovereign.email.sendToUser({
          to: sub,
          subject: cut(notice.email.subject, 200),
          body: cut(notice.email.text, 5000),
          link: deps.absolute(notice.path),
          key: notice.key,
        });
        return { outcome: 'sent' };
      } catch (error) {
        if (error instanceof NotSupportedError) {
          rest('this core does not serve email');
          return { outcome: 'no_channel' };
        }
        if (error instanceof CoreApiError) {
          if (error.status === 403) {
            rest('this app may not send email');
            return { outcome: 'not_permitted' };
          }
          if (error.status === 429)
            return {
              outcome: 'retry_after',
              ...(error.retryAfter !== undefined ? { retryAfterSeconds: error.retryAfter } : {}),
            };
          return { outcome: 'failed' };
        }
        return { outcome: 'failed' };
      }
    },
  };
}

/**
 * **A line on the person's activity page at core** (`sv.app.activity.log`), for what the app did for them: a book exported, a file imported. It never throws and never holds
 * up what it is about: with no core, an older core, or a core that refuses, it does nothing, and says so once and then rests like the channels. What it is told is a sentence
 * and a path of this app, **no amount, name or note of the book**.
 */
export function activityLogger(deps: {
  sovereign: Pick<Sovereign['app'], 'activity'>;
  subOf(accountId: string): Promise<string | undefined>;
  absolute(path: string): string;
  now(): number;
  log?: Log;
}): (entry: { accountId: string; summary: string; path: string; key: string }) => Promise<Result> {
  let restUntil = 0;
  const rest = (why: string) => {
    if (deps.now() >= restUntil) deps.log?.(`activity: ${why}; resting`);
    restUntil = deps.now() + CORE_REST_MS;
  };
  return async (entry) => {
    if (deps.now() < restUntil) return { outcome: 'no_channel' };
    try {
      const sub = await deps.subOf(entry.accountId);
      if (!sub) return { outcome: 'no_channel' };
      await deps.sovereign.activity.log({
        to: sub,
        summary: cut(entry.summary, 200),
        link: deps.absolute(entry.path),
        key: entry.key,
      });
      return { outcome: 'sent' };
    } catch (error) {
      if (error instanceof NotSupportedError) {
        rest('this core does not serve activity');
        return { outcome: 'no_channel' };
      }
      if (error instanceof CoreApiError && error.status === 403) {
        rest('this app may not write activity');
        return { outcome: 'not_permitted' };
      }
      return { outcome: 'failed' };
    }
  };
}
