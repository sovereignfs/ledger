import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, signOut, signedIn, trySignIn } from './helpers';

/**
 * Signing up, in, and out, in a browser (task 2.1). The instance is closed to sign-up, so the first account is the only one there will be, and it
 * is made by whichever browser gets here first: both browsers share the instance, so every test below starts by making sure there is one.
 */
test('the first account can be made, and a visitor is sent to sign in', async ({ page }) => {
  await ensureAccount(page);
  await page.goto('/budget');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
});

test('signing in with the right password shows who is signed in, and signing out ends it', async ({
  page,
}) => {
  // Signed in, and the book set up: a fresh account lands on the wizard, which has no user menu, and which of the tests has made one first depends on how they are split between runs.
  await signedIn(page);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

  // Signed in, the sign-in page has nothing to ask.
  await page.goto('/sign-in');
  await expect(page).toHaveURL(/\/$/);

  await signOut(page);
  await page.goto('/budget');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('a wrong password reads the same as an address with no account, and signs no one in', async ({
  page,
}) => {
  await ensureAccount(page);
  const messages: string[] = [];
  for (const email of [EMAIL, 'nobody@example.com']) {
    await trySignIn(page, email, 'not the password at all');
    const alert = page.getByText(/do not match/);
    await expect(alert).toBeVisible();
    messages.push((await alert.textContent()) ?? '');
  }
  expect(messages[1]).toBe(messages[0]);
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
});

test('a second account is refused by the server, and the page does not offer one', async ({
  page,
  request,
}) => {
  await ensureAccount(page);
  // The browser's own origin, which is what a page of ours would send.
  const origin = new URL(page.url()).origin;
  const reply = await request.post('/api/auth/sign-up/email', {
    headers: { origin },
    data: { name: 'Mallory', email: 'mallory@example.com', password: PASSWORD },
  });
  expect(reply.status()).toBe(403);
  expect((await reply.json()).code).toBe('SIGNUP_CLOSED');

  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: 'Sign-up is closed' })).toBeVisible();
});
