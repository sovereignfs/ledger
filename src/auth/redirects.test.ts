import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { MemoryMailer } from '../mail/memory';
import { type TestAuth, type TestClient, makeAuth } from './test-support';

/**
 * Where a sign-in route may send a person (DESIGN.md §13.1, §19): **only to this app's own address.** Every route of better-auth that takes a return
 * address (a sign-in, a sign-up, a reset, a verification, ) is given another site's, and a relative path that
 * escapes to one, and must refuse it, so that none of them is a way to send someone from a trusted link to a page of an attacker's.
 */
const { leg } = testTarget();
const PASSWORD = 'correct horse battery';
const HOSTILE = [
  'https://evil.example.com/steal',
  '//evil.example.com/steal',
  '/\\evil.example.com',
  'javascript:alert(1)',
  'http://localhost:3000.evil.example.com/',
];

let t: TestAuth;
let mailer: MemoryMailer;
let n = 0;
beforeAll(async () => {
  mailer = new MemoryMailer();
  t = await makeAuth({ signUp: 'open' }, mailer);
});
afterAll(async () => {
  await t.close();
});
const visitor = (): TestClient => t.client().from(`10.8.${Math.floor(n / 250)}.${(n++ % 250) + 1}`);

/** Whether a reply sends the browser somewhere that is not this app: a refusal is not one, and neither is a redirect to a path of our own. */
function leavesTheApp(reply: { status: number; headers: Headers; body: unknown }): boolean {
  const where = reply.headers.get('location') ?? '';
  const inBody = JSON.stringify(reply.body ?? '');
  const external = (text: string) => /evil\.example\.com|javascript:/i.test(text);
  return external(where) || (reply.status < 400 && external(inBody));
}

describe(`return addresses (${leg})`, () => {
  it('are refused when another site’s, for a password sign-in and sign-up', async () => {
    for (const hostile of HOSTILE) {
      const address = `redirect${++n}@example.com`;
      const up = await visitor().post('/api/auth/sign-up/email', {
        name: 'Ada',
        email: address,
        password: PASSWORD,
        callbackURL: hostile,
      });
      expect(leavesTheApp(up), `sign-up to ${hostile}`).toBe(false);
      const client = visitor();
      const reply = await client.post('/api/auth/sign-in/email', {
        email: address,
        password: PASSWORD,
        callbackURL: hostile,
      });
      expect(leavesTheApp(reply), `sign-in to ${hostile}`).toBe(false);
    }
  });

  it('are refused when another site’s, for a reset and for a verification', async () => {
    const address = `redirect${++n}@example.com`;
    await visitor().post('/api/auth/sign-up/email', {
      name: 'Ada',
      email: address,
      password: PASSWORD,
    });
    for (const hostile of HOSTILE) {
      const reset = await visitor().post('/api/auth/request-password-reset', {
        email: address,
        redirectTo: hostile,
      });
      expect(leavesTheApp(reset), `reset to ${hostile}`).toBe(false);
      const verify = await visitor().post('/api/auth/send-verification-email', {
        email: address,
        callbackURL: hostile,
      });
      expect(leavesTheApp(verify), `verification to ${hostile}`).toBe(false);
    }
    // And no mail carries a link to another site: every link in what was sent is to this app.
    for (const sent of mailer.sent)
      for (const link of sent.text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])
        expect(new URL(link).origin, link).toBe(t.settings.url);
  });
});
