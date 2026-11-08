import { expect, test } from '@playwright/test';
import { ensureAccount, signedIn } from './helpers';

/**
 * The front address (task 2.2, DESIGN.md §14.3): the landing page for a visitor, and Overview, at the same address, for someone signed in.
 */
test('a visitor sees what Ledger is, and a way in', async ({ page }) => {
  await ensureAccount(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'kept on a server of your own',
  );
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  // The first account exists and sign-up is closed, so the page does not offer one.
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);
  // It is a page and not the frame of the app: no places, no avatar menu.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('someone signed in sees Overview at the same address, and its other address leads back here', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await page.goto('/home');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
});

test.describe('at a phone’s width', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the landing page fits, with nothing to scroll sideways', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
