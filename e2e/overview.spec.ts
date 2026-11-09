import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Overview (task 9.2, DESIGN.md §14.3): this month's figures, net worth, the rows closest to their budget, recent transactions, and the setup checklist, from
 * which Add works. Fixtures are made through the app's own routes with its own `Origin`.
 */
async function fixtures(page: Page, tag: string) {
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const reply = await page.request.post(path, { data, headers: { origin } });
    expect(reply.status(), path).toBe(201);
    return ((await reply.json()) as { id: string }).id;
  };
  const bank = await post('/api/accounts', {
    type: 'bank',
    name: `Bank ${tag}`,
    currency: 'USD',
    opening: { amount: 1_000_000, date: '2020-01-01' },
  });
  const category = await post('/api/categories', { name: `Food ${tag}`, currency: 'USD' });
  const sub = await post(`/api/categories/${category}/subcategories`, { name: `Treats ${tag}` });
  const budget = await page.request.post('/api/budget', {
    data: { kind: 'subcategory', id: sub, amount: 1000, when: 'this' },
    headers: { origin },
  });
  expect(budget.status()).toBe(200);
  const today = new Date().toISOString().slice(0, 10);
  await post('/api/transactions', {
    type: 'expense',
    date: today,
    payee: `Sweet shop ${tag}`,
    lines: [
      { account: bank, amount: -2500, currency: 'USD' },
      { subcategory: sub, amount: 2500, currency: 'USD' },
    ],
  });
  return { sub: `Treats ${tag}`, payee: `Sweet shop ${tag}` };
}

test('shows this month, net worth, a row that is over its budget, and the latest entries', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `overview ${browserName}`);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  const month = page.getByRole('region', { name: 'This month' });
  await expect(month).toContainText('Net worth');
  // The sums are in the base currency once setup has chosen one; until then the screen says so, and Net worth is each currency's own.
  await expect(month).toContainText(/Spent|Choose a base currency/);
  const close = page.getByRole('region', { name: 'Closest to budget' });
  await expect(close.getByRole('link', { name: new RegExp(f.sub) })).toContainText(
    '$25.00 of $10.00 · over by $15.00',
  );
  const recent = page.getByRole('region', { name: 'Recent transactions' });
  await expect(recent).toContainText(f.payee);
  await expect(recent.getByRole('link', { name: 'All transactions' })).toBeVisible();
  await close.getByRole('link', { name: new RegExp(f.sub) }).click();
  await expect(page).toHaveURL(/\/budget\?month=\d{4}-\d{2}&row=/);
});

test('has a setup checklist that Add works from, that can be put away and brought back, and that is only for what can be done', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/');
  const checklist = page.getByRole('region', { name: 'Setup checklist' });
  await expect(checklist).toBeVisible();
  await expect(checklist).toContainText('Add the bills you pay every month');
  // Bills and jars are real: they say where to go until the book has one, and are ticked after, so the instance's own state decides which. Neither is "coming".
  await expect(checklist).toContainText('Set money aside in a jar');
  await expect(checklist).not.toContainText('Coming soon');
  await expect(
    checklist.getByRole('link', { name: 'Add someone you lend to or owe' }),
  ).toHaveAttribute('href', '/accounts');
  // Add works from it.
  await checklist.getByRole('button', { name: 'Add an entry' }).click();
  await expect(page.getByRole('dialog', { name: 'Add entry' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Put away, and it stays away on this device; a link brings it back.
  await checklist.getByRole('button', { name: 'Put the checklist away' }).click();
  await expect(page.getByRole('region', { name: 'Setup checklist' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Setup checklist' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show the setup checklist' }).click();
  await expect(page.getByRole('region', { name: 'Setup checklist' })).toBeVisible();
});
