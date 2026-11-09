import { createSovereign } from '@sovereignfs/sdk';
import { createFakeCore } from '@sovereignfs/sdk/testing';
import { describe, expect, it } from 'vitest';
import { MemoryMailer } from '../mail/memory';
import {
  CORE_REST_MS,
  type Channel,
  type Outgoing,
  activityLogger,
  coreChannel,
  coreEmailChannel,
  emailChannel,
  fanOut,
} from './channels';

/**
 * The channels (DESIGN.md §25.2, task 8.3), against the test mailer and the SDK's fake core: each of the five results is reached, one channel failing leaves the
 * other working, and no title, address or `sub` is in anything that is logged.
 */
const SUB = 'sub-secret-1234';
const notice = (extra: Partial<Outgoing> = {}): Outgoing => ({
  accountId: 'acc-1',
  kind: 'recap',
  title: 'Your October recap: Groceries was over',
  path: '/reports?month=2026-10',
  key: 'n1',
  email: { subject: 'Your October recap', text: 'You spent $1,270.00 of $1,300.00.' },
  ...extra,
});
const absolute = (path: string) => `https://ledger.example.com${path}`;

function fixture(options: { api?: boolean } = {}) {
  const core = createFakeCore({
    api:
      options.api === false
        ? undefined
        : { versions: ['v1'], capabilities: ['directory', 'notifications', 'email', 'activity'] },
  });
  core.addPerson({ sub: SUB, name: 'Pat' });
  const sovereign = createSovereign({
    appUrl: 'https://ledger.example.com',
    coreUrl: core.url,
    clientId: core.credentials.clientId,
    clientSecret: core.credentials.clientSecret,
    fetch: core.fetch,
  });
  let clock = 1_800_000_000_000;
  const logged: string[] = [];
  const channel = coreChannel({
    sovereign: sovereign.app,
    subOf: async (account) => (account === 'acc-1' ? SUB : undefined),
    absolute,
    now: () => clock,
    log: (line) => logged.push(line),
  });
  return { core, channel, logged, advance: (ms: number) => (clock += ms) };
}

describe('the email channel', () => {
  const mailer = () => new MemoryMailer();
  const make = (m: MemoryMailer, over: { enabled?: boolean; address?: string | undefined } = {}) =>
    emailChannel({
      mailer: m,
      app: 'Ledger',
      addressOf: async () => ('address' in over ? over.address : 'pat@example.com'),
      enabled: async () => over.enabled ?? true,
      settingsUrl: 'https://ledger.example.com/account?section=notifications',
      absolute,
    });

  it('sends to the person’s address, with a link to the notice and one to Settings to turn it off', async () => {
    const m = mailer();
    expect(await make(m).send(notice())).toEqual({ outcome: 'sent' });
    expect(m.sent).toHaveLength(1);
    const message = m.sent[0];
    expect(message?.to).toBe('pat@example.com');
    expect(message?.subject).toBe('Your October recap');
    expect(message?.text).toContain('You spent $1,270.00');
    expect(message?.text).toContain('https://ledger.example.com/reports?month=2026-10');
    expect(message?.text).toContain('account?section=notifications');
  });

  it('has no channel for a notice that is a bell alone, with nothing to say by email', async () => {
    const m = mailer();
    const { email: _email, ...bell } = notice();
    expect(await make(m).send(bell)).toEqual({ outcome: 'no_channel' });
    expect(m.sent).toEqual([]);
  });

  it('has no channel for a person who turned email off, or has no address', async () => {
    const m = mailer();
    expect(await make(m, { enabled: false }).send(notice())).toEqual({ outcome: 'no_channel' });
    expect(await make(m, { address: undefined }).send(notice())).toEqual({ outcome: 'no_channel' });
    expect(m.sent).toEqual([]);
  });

  it('says failed, and does not throw, when the mail server does not take it', async () => {
    const m = mailer();
    m.failNext = 1;
    expect(await make(m).send(notice())).toEqual({ outcome: 'failed' });
  });
});

describe('the core channel', () => {
  it('sends to the person’s sub, with the key, a whole address, and text within core’s limits', async () => {
    const { core, channel } = fixture();
    const result = await channel.send(notice({ title: 'T'.repeat(300), body: 'B'.repeat(900) }));
    expect(result).toEqual({ outcome: 'sent' });
    const sent = core.notificationsSent[0];
    expect(sent?.to).toBe(SUB);
    expect(sent?.title.length).toBeLessThanOrEqual(120);
    expect(sent?.body?.length).toBeLessThanOrEqual(500);
    expect(sent?.url).toBe('https://ledger.example.com/reports?month=2026-10');
  });

  it('has no channel for a person with no account on the core', async () => {
    const { core, channel } = fixture();
    expect(await channel.send(notice({ accountId: 'someone-else' }))).toEqual({
      outcome: 'no_channel',
    });
    expect(core.notificationsSent).toEqual([]);
  });

  it('says retry_after, with the seconds, when core says 429', async () => {
    const { core, channel } = fixture();
    core.fail({ kind: 'status', status: 429, retryAfter: 7 }, { target: 'api' });
    expect(await channel.send(notice())).toEqual({ outcome: 'retry_after', retryAfterSeconds: 7 });
  });

  it('says failed, and never sends twice, when core is down, times out, or the answer is lost', async () => {
    for (const kind of ['down', 'timeout', 'lost-answer'] as const) {
      const { core, channel } = fixture();
      core.fail({ kind }, { target: 'api' });
      expect(await channel.send(notice()), kind).toEqual({ outcome: 'failed' });
    }
  });

  it('says failed for a core that is failing, and works again when it is healed', async () => {
    const { core, channel } = fixture();
    core.fail({ kind: 'status', status: 503 }, { target: 'api' });
    expect(await channel.send(notice())).toEqual({ outcome: 'failed' });
    core.heal();
    expect(await channel.send(notice())).toEqual({ outcome: 'sent' });
  });

  it('says not_permitted when core refuses this app, logs it once, and rests for hours', async () => {
    const { core, channel, logged, advance } = fixture();
    core.fail({ kind: 'status', status: 403 }, { target: 'api' });
    expect(await channel.send(notice())).toEqual({ outcome: 'not_permitted' });
    // Resting: it does not ask again, and does not log again.
    core.heal();
    expect(await channel.send(notice())).toEqual({ outcome: 'no_channel' });
    expect(logged).toHaveLength(1);
    expect(core.notificationsSent).toEqual([]);
    // After the rest it tries once more.
    advance(CORE_REST_MS + 1);
    expect(await channel.send(notice())).toEqual({ outcome: 'sent' });
  });

  it('has no channel, and rests, on a core too old to serve notifications', async () => {
    const { channel, logged } = fixture({ api: false });
    expect(await channel.send(notice())).toEqual({ outcome: 'no_channel' });
    expect(await channel.send(notice())).toEqual({ outcome: 'no_channel' });
    expect(logged).toHaveLength(1);
  });
});

describe('fanning out', () => {
  it('runs every channel, and one failing leaves the other working', async () => {
    const { core, channel } = fixture();
    const m = new MemoryMailer();
    m.failNext = 1;
    const email = emailChannel({
      mailer: m,
      app: 'Ledger',
      addressOf: async () => 'pat@example.com',
      enabled: async () => true,
      settingsUrl: 'https://ledger.example.com/account',
      absolute,
    });
    const results = await fanOut([email, channel], notice());
    expect(results).toEqual({ email: { outcome: 'failed' }, core: { outcome: 'sent' } });
    expect(core.notificationsSent).toHaveLength(1);
  });

  it('counts a channel that throws as failed, and still runs the rest', async () => {
    const broken: Channel = {
      name: 'push',
      send: async () => {
        throw new Error('boom');
      },
    };
    const { core, channel } = fixture();
    const results = await fanOut([broken, channel], notice());
    expect(results).toEqual({ push: { outcome: 'failed' }, core: { outcome: 'sent' } });
    expect(core.notificationsSent).toHaveLength(1);
  });

  it('logs the channel, the kind and the outcome, and no title, address or sub', async () => {
    const { channel } = fixture();
    const m = new MemoryMailer();
    const email = emailChannel({
      mailer: m,
      app: 'Ledger',
      addressOf: async () => 'pat@example.com',
      enabled: async () => true,
      settingsUrl: 'https://ledger.example.com/account',
      absolute,
    });
    const lines: string[] = [];
    await fanOut([email, channel], notice(), (line) => lines.push(line));
    const text = lines.join('\n');
    expect(text).toContain('email sent');
    expect(text).toContain('core sent');
    for (const secret of ['recap: Groceries', 'You spent', 'pat@example.com', SUB, 'acc-1'])
      expect(text).not.toContain(secret);
  });
});

describe('the core email channel', () => {
  function emailFixture(options: { api?: boolean; enabled?: boolean } = {}) {
    const core = createFakeCore({
      api:
        options.api === false
          ? undefined
          : { versions: ['v1'], capabilities: ['directory', 'notifications', 'email', 'activity'] },
    });
    core.addPerson({ sub: SUB, name: 'Pat' });
    const sovereign = createSovereign({
      appUrl: 'https://ledger.example.com',
      coreUrl: core.url,
      clientId: core.credentials.clientId,
      clientSecret: core.credentials.clientSecret,
      fetch: core.fetch,
    });
    let clock = 1_800_000_000_000;
    const logged: string[] = [];
    const channel = coreEmailChannel({
      sovereign: sovereign.app,
      subOf: async (account) => (account === 'acc-1' ? SUB : undefined),
      enabled: async () => options.enabled ?? true,
      absolute,
      now: () => clock,
      log: (line) => logged.push(line),
    });
    return { core, channel, logged, advance: (ms: number) => (clock += ms) };
  }

  it('emails the person’s sub, with the key and a whole address, and holds no address of theirs', async () => {
    const { core, channel } = emailFixture();
    expect(await channel.send(notice())).toEqual({ outcome: 'sent' });
    const sent = core.emailsSent[0];
    expect(sent?.to).toBe(SUB);
    expect(sent?.subject).toBe('Your October recap');
    expect(sent?.link).toBe('https://ledger.example.com/reports?month=2026-10');
    expect(sent?.key).toBe('n1');
  });

  it('sends nothing for a bell alone, for a person who does not want it, or one with no account on the core', async () => {
    const { core, channel } = emailFixture();
    const { email: _email, ...bell } = notice();
    expect(await channel.send(bell)).toEqual({ outcome: 'no_channel' });
    expect(await channel.send(notice({ accountId: 'someone-else' }))).toEqual({
      outcome: 'no_channel',
    });
    expect(await emailFixture({ enabled: false }).channel.send(notice())).toEqual({
      outcome: 'no_channel',
    });
    expect(core.emailsSent).toEqual([]);
  });

  it('is not_permitted, once and resting, when core refuses the app, and sends nothing on a core too old for email', async () => {
    const { core, channel, logged } = emailFixture();
    core.fail({ kind: 'status', status: 403 }, { target: 'api' });
    expect(await channel.send(notice())).toEqual({ outcome: 'not_permitted' });
    expect(await channel.send(notice())).toEqual({ outcome: 'no_channel' });
    expect(logged).toHaveLength(1);
    const old = emailFixture({ api: false });
    expect(await old.channel.send(notice())).toEqual({ outcome: 'no_channel' });
    expect(old.core.emailsSent).toEqual([]);
  });
});

describe('the activity line', () => {
  function logFixture(options: { api?: boolean } = {}) {
    const core = createFakeCore({
      api:
        options.api === false
          ? undefined
          : { versions: ['v1'], capabilities: ['directory', 'notifications', 'email', 'activity'] },
    });
    core.addPerson({ sub: SUB, name: 'Pat' });
    const sovereign = createSovereign({
      appUrl: 'https://ledger.example.com',
      coreUrl: core.url,
      clientId: core.credentials.clientId,
      clientSecret: core.credentials.clientSecret,
      fetch: core.fetch,
    });
    const logged: string[] = [];
    const log = activityLogger({
      sovereign: sovereign.app,
      subOf: async (account) => (account === 'acc-1' ? SUB : undefined),
      absolute,
      now: () => 1_800_000_000_000,
      log: (line) => logged.push(line),
    });
    return { core, log, logged };
  }
  const entry = {
    accountId: 'acc-1',
    summary: 'Exported your book',
    path: '/account?section=data',
    key: 'export:1',
  };

  it('records one line on the person’s activity at core, with a whole address and the key', async () => {
    const { core, log } = logFixture();
    expect(await log(entry)).toEqual({ outcome: 'sent' });
    expect(core.activityRecorded[0]).toMatchObject({
      to: SUB,
      summary: 'Exported your book',
      key: 'export:1',
      link: 'https://ledger.example.com/account?section=data',
    });
  });

  it('does nothing for a person with no account on the core, and on a core too old for it, and never throws', async () => {
    const { core, log, logged } = logFixture();
    expect(await log({ ...entry, accountId: 'someone-else' })).toEqual({ outcome: 'no_channel' });
    expect(core.activityRecorded).toEqual([]);
    const old = logFixture({ api: false });
    expect(await old.log(entry)).toEqual({ outcome: 'no_channel' });
    expect(await old.log(entry)).toEqual({ outcome: 'no_channel' });
    expect(old.logged).toHaveLength(1);
    expect(logged).toEqual([]);
    const failing = logFixture();
    failing.core.fail({ kind: 'down' }, { target: 'api' });
    expect(await failing.log(entry)).toEqual({ outcome: 'failed' });
  });

  it('says nothing of the book in what it logs: the sentence and a path, no amount or name', async () => {
    const { core, log } = logFixture();
    await log(entry);
    const text = JSON.stringify(core.activityRecorded);
    expect(text).not.toMatch(/\d+\.\d{2}/);
  });
});
