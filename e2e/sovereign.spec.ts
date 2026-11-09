import { expect, test, type Page } from '@playwright/test';
import { gotoSettled, hydrated, signOut as signOutOf } from './helpers';
import { PORTS } from './ports';

/**
 * Signing in through Sovereign (task 2.3, DESIGN.md §13.1), a fake one (`e2e/fake-sovereign-server.ts`), on two instances of their own: one that takes only
 * Sovereign and only its first account, and one that takes both ways and anyone (their ports are in `e2e/ports.ts`). The instances keep their accounts between the two browsers,
 * so each test is the same whichever runs first: the same person signs in as the same account, and a stranger is turned away either way.
 */
const SOVEREIGN = `http://localhost:${PORTS.sovereign}`;
const BOTH = `http://localhost:${PORTS.both}`;
const FIRST = { sub: 'e2e-first', email: 'first@sovereign.test', name: 'Grace Hopper' };
const SECOND = { sub: 'e2e-second', email: 'second@sovereign.test', name: 'Alan Turing' };

/** Signs out from a page that has the menu: a person just signed in to a book not yet set up is on its setup, which has none. */
async function signOut(page: Page) {
  await gotoSettled(page, '/accounts');
  await signOutOf(page);
}

async function nextPersonIs(page: Page, who: { sub: string; email: string; name?: string }) {
  const reply = await page.request.post(`http://localhost:${PORTS.coreControl}/sign-in-as`, {
    data: who,
  });
  expect(reply.ok()).toBe(true);
}

/**
 * Starts the sign-in at Sovereign. Sign-in is rate-limited, three tries in ten seconds from one address, and both browsers reach these instances from the same
 * one: when told so, wait it out and go again, as a person would.
 */
async function throughSovereign(page: Page) {
  const button = page.getByRole('button', { name: 'Sign in with Sovereign' });
  const limited = page.getByText(/Too many tries/);
  // A button clicked before the page is hydrated does nothing.
  await hydrated(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    await button.click();
    await expect(
      limited
        .or(page.getByRole('button', { name: 'User menu' }))
        .or(page.getByRole('heading', { name: 'Set up your budget' }))
        .or(page.getByText(/Sign-up is closed|already an account/)),
    ).toBeVisible();
    if (!(await limited.isVisible())) {
      // Back from Sovereign, the browser is sent on (to the setup of a new book): let that finish before going anywhere else.
      await page.waitForLoadState('networkidle');
      return;
    }
    await page.waitForTimeout(10_500);
  }
}

test.describe('an instance that signs in through Sovereign only', () => {
  test.use({ baseURL: SOVEREIGN, viewport: { width: 1280, height: 800 } });
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test('offers Sovereign and nothing of the local ways, which are not there to find', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: 'Sign in with Sovereign' })).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /passkey/i })).toHaveCount(0);
    for (const path of ['/sign-up', '/forgot-password', '/reset-password']) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });

  test('the first person signs in as who Sovereign says they are, and signing out is local', async ({
    page,
  }) => {
    await nextPersonIs(page, FIRST);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await gotoSettled(page, '/accounts');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await page.getByRole('button', { name: 'User menu' }).click();
    await expect(page.getByText(FIRST.name)).toBeVisible();
    await expect(page.getByText(FIRST.email)).toBeVisible();
    await page.keyboard.press('Escape');

    // Signing out ends this session, and not Sovereign's: the next sign-in does not ask for anything again here, and is the same account.
    await signOut(page);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await gotoSettled(page, '/accounts');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await signOut(page);
  });

  test('a second person is turned back to the sign-in page and told why, and has no session', async ({
    page,
  }) => {
    await nextPersonIs(page, SECOND);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText(/Sign-up is closed/)).toBeVisible();
    await gotoSettled(page, '/accounts');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('a person who declines at Sovereign is told so and is not signed in', async ({ page }) => {
    await page.goto('/sign-in?error=access_denied');
    await expect(page.getByText(/You declined to share/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  });

  test('an account that came in through Sovereign has no password to manage, and cannot unlink its only way in', async ({
    page,
  }) => {
    await nextPersonIs(page, FIRST);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await gotoSettled(page, '/accounts');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

    await page.goto('/account?section=security');
    await expect(page.getByRole('heading', { name: 'You sign in with Sovereign' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Set up an authenticator app' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add a passkey' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unlink Sovereign' })).toBeDisabled();
    await expect(page.getByText('only way you can sign in')).toBeVisible();
    await signOut(page);
  });

  // What Sovereign tells the app when a person's session there ends, or they delete their account (task 2.4). The fake signs the notice with the key it
  // publishes, as Sovereign does, and the test posts it where the manifest says to.
  type Wrong = 'signature' | 'audience' | 'expired' | 'type';
  async function noticeFrom(
    page: Page,
    kind: 'logout' | 'account-deleted',
    sub: string,
    wrong?: Wrong,
  ): Promise<string> {
    const reply = await page.request.post(`http://localhost:${PORTS.coreControl}/notice`, {
      data: { kind, sub, sid: 'core-session-1', wrong },
    });
    expect(reply.ok()).toBe(true);
    return reply.text();
  }
  const sendLogout = (page: Page, token: string) =>
    page.request.post('/api/sovereign/backchannel-logout', { form: { logout_token: token } });
  const sendDeletion = (page: Page, token: string) =>
    page.request.post('/api/sovereign/account-deleted', { form: { account_deleted_token: token } });
  async function signInAs(page: Page, who: { sub: string; email: string; name?: string }) {
    await nextPersonIs(page, who);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await gotoSettled(page, '/accounts');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  }

  test('signing out at Sovereign signs the person out here, wherever they are signed in', async ({
    page,
    browser,
  }) => {
    await signInAs(page, FIRST);
    const other = await browser.newContext({ baseURL: SOVEREIGN });
    const elsewhere = await other.newPage();
    await signInAs(elsewhere, FIRST);

    const reply = await sendLogout(page, await noticeFrom(page, 'logout', FIRST.sub));
    expect(reply.status()).toBe(200);
    for (const tab of [page, elsewhere]) {
      await tab.goto('/accounts');
      await expect(tab).toHaveURL(/\/sign-in/);
    }
    await other.close();
    // And they can sign in again: the account is theirs still.
    await signInAs(page, FIRST);
    await signOut(page);
  });

  test('a notice that is wrong, or is sent twice, is refused and ends nothing', async ({
    page,
  }) => {
    await signInAs(page, FIRST);
    for (const wrong of ['signature', 'audience', 'expired', 'type'] as const) {
      const reply = await sendLogout(page, await noticeFrom(page, 'logout', FIRST.sub, wrong));
      expect(reply.status(), wrong).toBe(400);
      expect(await reply.json()).toEqual({ error: 'invalid_request' });
    }
    // A deletion token is not a logout token, nor the reverse.
    expect(
      (await sendLogout(page, await noticeFrom(page, 'account-deleted', FIRST.sub))).status(),
    ).toBe(400);
    expect((await sendDeletion(page, await noticeFrom(page, 'logout', FIRST.sub))).status()).toBe(
      400,
    );
    // Nothing at all, and not a form.
    expect(
      (await page.request.post('/api/sovereign/backchannel-logout', { form: {} })).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post('/api/sovereign/account-deleted', {
          data: { account_deleted_token: 'x.y.z' },
        })
      ).status(),
    ).toBe(400);
    // They are still signed in.
    await gotoSettled(page, '/accounts');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

    // The same good notice twice: the first ends the session, the second is a replay.
    const token = await noticeFrom(page, 'logout', FIRST.sub);
    expect((await sendLogout(page, token)).status()).toBe(200);
    expect((await sendLogout(page, token)).status()).toBe(400);
  });

  test('these addresses answer only a POST, and no one who asks for them is shown anything', async ({
    page,
  }) => {
    for (const path of ['/api/sovereign/backchannel-logout', '/api/sovereign/account-deleted']) {
      expect((await page.request.get(path)).status(), path).toBe(405);
    }
  });

  test('a person who deletes their account at Sovereign is deleted here, and the first-account rule is open again', async ({
    page,
  }) => {
    await signInAs(page, FIRST);
    const reply = await sendDeletion(page, await noticeFrom(page, 'account-deleted', FIRST.sub));
    expect(reply.status()).toBe(200);
    await gotoSettled(page, '/accounts');
    await expect(page).toHaveURL(/\/sign-in/);

    // Said again (a retry that was not needed), it is a notice about a person nobody here knows, and is answered 200.
    expect(
      (await sendDeletion(page, await noticeFrom(page, 'account-deleted', FIRST.sub))).status(),
    ).toBe(200);
    // The instance has no one in it now, so the next person to come is its first (the same person, as the tests that follow expect their account).
    await signInAs(page, FIRST);
    await signOut(page);
  });

  test('deleting the account asks for no password, deletes it, and leaves the instance open to its first person again', async ({
    page,
  }) => {
    await nextPersonIs(page, FIRST);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await gotoSettled(page, '/accounts');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

    await page.goto('/account?section=data');
    await page.getByRole('button', { name: 'Delete my account…' }).click();
    await expect(page.getByLabel('Your password')).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete my account for good' }).click();
    // It is sent to the front address when it is done, which for a cookie that is no one's any more is the sign-in page.
    await expect(page.getByRole('button', { name: 'Sign in with Sovereign' })).toBeVisible();
    await gotoSettled(page, '/accounts');
    await expect(page).toHaveURL(/\/sign-in/);

    // The instance has no one in it now, so the next person to come is its first, and is let in (the same person: the tests that follow, and the other
    // browser's run of these, expect the instance to have their account).
    // Deleting ends the sessions before it removes the account, so the sign-in page can show a moment before the instance is empty: it is asked until it is.
    await expect(async () => {
      await nextPersonIs(page, FIRST);
      await page.goto('/sign-in');
      await throughSovereign(page);
      await gotoSettled(page, '/accounts');
      await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000, intervals: [1_000] });
    await signOut(page);
  });
});

/** A local account made on the instance that offers both ways, signed in. */
async function signUpLocal(page: Page, name: string): Promise<{ email: string; name: string }> {
  const email = `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/sign-up');
  await hydrated(page);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  const limited = page.getByText(/Too many tries/);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(
      limited
        .or(page.getByRole('button', { name: 'User menu' }))
        .or(page.getByRole('heading', { name: 'Set up your budget' })),
    ).toBeVisible();
    if (!(await limited.isVisible())) break;
    await page.waitForTimeout(10_500);
  }
  // A new book is sent to its setup, which has no menu: the accounts have it.
  await gotoSettled(page, '/accounts');
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  return { email, name };
}

test.describe('an instance that offers both ways', () => {
  test.use({ baseURL: BOTH, viewport: { width: 1280, height: 800 } });
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test('shows a password and Sovereign, and each signs in', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Sovereign' })).toBeVisible();

    await nextPersonIs(page, {
      sub: 'e2e-both-1',
      email: 'both-one@sovereign.test',
      name: 'Katherine Johnson',
    });
    await throughSovereign(page);
    await gotoSettled(page, '/accounts');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await signOut(page);

    // And an account with a password, made here, still signs in with it.
    await page.goto('/sign-up');
    await hydrated(page);
    const email = `local-${Date.now()}@example.com`;
    await page.getByLabel('Name').fill('Local Ada');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your budget' })).toBeVisible();
    await signOut(page);
  });

  test('a Sovereign login with a local account’s address is refused, with what to do instead', async ({
    page,
  }) => {
    const email = `taken-${Date.now()}@example.com`;
    await page.goto('/sign-up');
    await hydrated(page);
    await page.getByLabel('Name').fill('Local Grace');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your budget' })).toBeVisible();
    await signOut(page);

    await nextPersonIs(page, { sub: `e2e-both-${Date.now()}`, email, name: 'Someone Else' });
    await page.goto('/sign-in');
    await throughSovereign(page);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText(/already an account here/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  });

  test('a local account links Sovereign from Settings, then signs in with it as the same account', async ({
    page,
  }) => {
    const { email, name } = await signUpLocal(page, 'Local Margaret');
    await nextPersonIs(page, {
      sub: `e2e-link-${Date.now()}`,
      email,
      name: 'Someone Else At Sovereign',
    });
    await page.goto('/account?section=security');
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
    await page.getByRole('button', { name: 'Link Sovereign' }).click();

    await expect(page).toHaveURL(/\/account\?section=security&linked=1/);
    await expect(page.getByText('Sovereign is linked.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlink Sovereign' })).toBeEnabled();

    await gotoSettled(page, '/accounts');
    await signOut(page);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await gotoSettled(page, '/accounts');
    // The account is the local one: its name, not the name Sovereign has for the person.
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await page.getByRole('button', { name: 'User menu' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await signOut(page);
  });

  test('a Sovereign account with a different address is refused with the reason, and nothing is linked', async ({
    page,
  }) => {
    await signUpLocal(page, 'Local Mary');
    await nextPersonIs(page, {
      sub: `e2e-other-${Date.now()}`,
      email: `other-${Date.now()}@sovereign.test`,
      name: 'Not The Same',
    });
    await page.goto('/account?section=security');
    await page.getByRole('button', { name: 'Link Sovereign' }).click();

    await expect(page).toHaveURL(/\/account\?section=security/);
    await expect(page.getByText(/different email address/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link Sovereign' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlink Sovereign' })).toHaveCount(0);
    await signOut(page);
  });

  test('can be unlinked, after which the same Sovereign login is turned back with what to do', async ({
    page,
  }) => {
    const { email } = await signUpLocal(page, 'Local Dorothy');
    const who = { sub: `e2e-undo-${Date.now()}`, email, name: 'Same Person' };
    await nextPersonIs(page, who);
    await page.goto('/account?section=security');
    await page.getByRole('button', { name: 'Link Sovereign' }).click();
    await expect(page.getByText('Sovereign is linked.')).toBeVisible();

    await page.getByRole('button', { name: 'Unlink Sovereign' }).click();
    await page.getByRole('button', { name: 'Unlink', exact: true }).click();
    await expect(page.getByText('Sovereign is unlinked.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link Sovereign' })).toBeVisible();

    await gotoSettled(page, '/accounts');
    await signOut(page);
    await nextPersonIs(page, who);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await expect(page.getByText(/already an account here/)).toBeVisible();
  });
});
