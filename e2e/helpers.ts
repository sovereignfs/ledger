import { expect, type Page } from '@playwright/test';

/**
 * What the browser tests that need a signed-in person share. The instance is closed to sign-up, so the first account is the only one there will be,
 * and it is made by whichever test gets here first: both browsers share the instance, so every test starts by making sure there is one.
 */
export const EMAIL = 'owner@example.com';
export const PASSWORD = 'correct horse battery';

export async function ensureAccount(page: Page) {
  await page.goto('/sign-up');
  const create = page.getByRole('heading', { name: 'Create your account' });
  if (!(await create.isVisible())) return;
  await page.getByLabel('Name').fill('Ada');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  // A new account lands at the front address: Overview, or the wizard, which has no shell and so no menu to sign out from. The session is ended here, not
  // through the menu, so that the book is left as the wizard would find it.
  await expect(
    page
      .getByRole('button', { name: 'User menu' })
      .or(page.getByRole('heading', { name: 'Set up your budget' })),
  ).toBeVisible();
  await page.context().clearCookies();
}

/**
 * Opens the sign-in page. Right after the page has signed itself out it is already on its way to `/sign-in`, and WebKit then refuses a second
 * navigation to the same address ("interrupted by another navigation"). That one is not a failure: the page is going where we asked, so let it
 * arrive, and only ask again if it did not.
 */
async function gotoSignIn(page: Page) {
  try {
    await page.goto('/sign-in');
  } catch (error) {
    if (!/interrupted by another navigation/.test(String(error))) throw error;
    await page.waitForLoadState('load');
    if (new URL(page.url()).pathname !== '/sign-in') await page.goto('/sign-in');
  }
}

/**
 * Fills the sign-in form and submits it. Sign-in is rate-limited per address (three attempts in ten seconds), and both browsers reach this instance
 * from the same one, so an attempt can be told to wait: it then does, once the window has passed, as a person would.
 */
export async function trySignIn(page: Page, email: string, password: string) {
  await gotoSignIn(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const submit = page.getByRole('button', { name: 'Sign in' });
  await submit.click();
  const limited = page.getByText(/Too many tries/);
  // Signing in lands at the front address, which is Overview, or the wizard for a book that is not set up yet, which has no shell and so no user menu.
  const outcome = page
    .getByText(/do not match/)
    .or(page.getByRole('button', { name: 'User menu' }))
    .or(page.getByRole('heading', { name: 'Set up your budget' }));
  await expect(limited.or(outcome)).toBeVisible();
  if (await limited.isVisible()) {
    await page.waitForTimeout(10_500);
    await submit.click();
  }
}

/**
 * Makes sure there is an account, and signs it in. **The book is set up too** (`POST /api/setup` with `done`), as a person who has been through the wizard has,
 * so that the front address shows Overview and not the wizard; `setup: false` is for the one test that goes through it (`00-setup.spec.ts`).
 */
export async function signedIn(page: Page, options: { setup?: boolean } = {}) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  // Signed in, whichever way it came about, which includes a second attempt after a wait for the rate limit: Overview, or the wizard of a book not set up.
  await expect(
    page
      .getByRole('button', { name: 'User menu' })
      .or(page.getByRole('heading', { name: 'Set up your budget' })),
  ).toBeVisible();
  if (options.setup === false) return;
  const reply = await page.request.post('/api/setup', {
    data: { step: 'done' },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(reply.status(), 'finishing setup').toBe(200);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
}
