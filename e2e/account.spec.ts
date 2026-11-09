import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Settings (task 2.6, DESIGN.md §15.1): a dialog over the page it was opened from, and a page of its own at `/account`, with the same sections.
 */
test('opens from the avatar menu as a dialog over the page, and closing it goes back to that page', async ({
  page,
}) => {
  await signedIn(page);
  for (const place of ['/', '/budget', '/reports']) {
    await page.goto(place);
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/account$/);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${place === '/' ? '/' : place}$`));
  }
});

test('is a page at its own address, and an address that names a section opens it', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Profile' })).toBeVisible();
  await page.goto('/account?section=security');
  await expect(page.getByRole('region', { name: 'Security' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Profile' })).toBeHidden();
  // A name that is not a section is not an error: Profile opens.
  await page.goto('/account?section=billing');
  await expect(page.getByRole('region', { name: 'Profile' })).toBeVisible();
});

test('has its sections, and each shows what it is for', async ({ page }) => {
  await signedIn(page);
  await page.goto('/account');
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(sections.getByRole('button')).toHaveText([
    'Profile',
    'Security',
    'Preferences',
    'Book',
    'Currencies',
    'Budget',
    'Notifications',
    'Data',
  ]);
  await sections.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible();
  const devices = page.getByRole('list', { name: 'Signed-in devices' });
  await expect(devices.getByText('This device')).toHaveCount(1);
  await sections.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByRole('heading', { name: 'Delete account' })).toBeVisible();
});

test('the theme chosen in Preferences applies at once and is still there after a reload', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/account?section=preferences');
  const theme = page
    .getByRole('group', { name: 'Theme' })
    .or(page.getByRole('radiogroup', { name: 'Theme' }));
  await theme.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/account?section=preferences');
  await theme.getByText('System', { exact: true }).click();
});

test('deleting the account says what goes before it asks, and does not delete on a wrong password', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/account?section=data');
  await page.getByRole('button', { name: 'Delete my account…' }).click();
  const form = page.getByRole('form', { name: 'Delete account' });
  await expect(form.getByText(/your budget/)).toBeVisible();
  await expect(form.getByText(/cannot be undone/)).toBeVisible();
  await form.getByLabel('Password').fill('not the password at all');
  await form.getByRole('button', { name: /Delete/ }).click();
  await expect(page.getByText('That is not your password.')).toBeVisible();
  // Still signed in, with the account.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
});
