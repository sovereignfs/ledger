import { expect, test, type Page } from '@playwright/test';
import { PORTS } from './ports';

/**
 * The first browser tests: the built app is up on its database, its page is the frame it should be, and the browser enforces the policy it is
 * sent. They are small on purpose: the point is that there is a way to test what only a browser can show, and that it fails when the page is
 * broken.
 */

/** Records every Content-Security-Policy violation the page raises, from before it runs anything. */
async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
}

test('the app is up on its database, and says which', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(['sqlite', 'postgres']).toContain(body.database);
});

test('the page is the shell: a header with the wordmark, the places, and the main area', async ({
  page,
}) => {
  const violations = await recordViolations(page);
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/');

  await expect(page).toHaveTitle('Overview · Ledger');
  const header = page.getByRole('banner');
  // The wordmark, drawn lowercase and silent, since the link says the name.
  await expect(header.getByRole('link', { name: 'Ledger' })).toBeVisible();
  await expect(header.getByText('ledger.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  const places = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
  await expect(places).toHaveText(['Overview', 'Transactions', 'Budget', 'Accounts', 'Reports']);
  expect(await violations()).toEqual([]);
  expect(errors.filter((text) => !/favicon|Failed to load resource/.test(text))).toEqual([]);
});

test('each place opens, and is marked as the current one', async ({ page }) => {
  await page.goto('/');
  const places = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Transactions', 'Budget', 'Accounts', 'Reports']) {
    await places.getByRole('link', { name: name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(places.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
  }
});

test('the browser refuses an inline event handler, which the policy does not allow', async ({
  page,
}) => {
  const violations = await recordViolations(page);
  await page.goto('/');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<img src="data:," onerror="window.__ran = true">',
    );
  });
  await expect.poll(violations).toContain('script-src-attr inline');
  expect(
    await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran),
  ).toBeUndefined();
});

test('a page that is not there is a page, with a way back', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();
  await page.getByRole('link', { name: 'Go back to Ledger' }).click();
  await expect(page).toHaveURL('/');
});

test.describe('in dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the page is dark from the first paint, with no flash of light', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(9, 9, 11)');
  });
});

test.describe('at a phone’s width', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the header and the page fit, with nothing to scroll sideways', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('banner')).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('the footer has the places, and the sidebar is not drawn', async ({ page }) => {
    await page.goto('/budget');
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Budget' })).toHaveAttribute('href', '/budget');
    await expect(footer.getByRole('link', { name: 'Budget' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The same addresses as the sidebar of a wide screen: the width decides what is drawn and nothing else.
    for (const [name, href] of [
      ['Overview', '/'],
      ['Transactions', '/transactions'],
      ['Accounts', '/accounts'],
    ] as const) {
      await expect(footer.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    await expect(page.locator('nav[aria-label="Main"]').first()).toBeHidden();
  });
});

test('the typeface is the design system’s, served from this origin', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/');
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toContain('Hanken Grotesk');
  const foreign = requested.filter(
    (url) => !url.startsWith(`http://localhost:${PORTS.app}/`) && !url.startsWith('data:'),
  );
  expect(foreign).toEqual([]);
});
