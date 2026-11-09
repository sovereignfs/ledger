import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Transfers and refunds (task 4.6, DESIGN.md §6.2, §6.8): paying a card from checking changes both balances, a transfer between two currencies keeps both
 * amounts and shows their rate, and a refund puts the money back. Fixtures are made through the app's own routes with its own `Origin`.
 */
async function fixtures(page: Page, tag: string) {
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const reply = await page.request.post(path, { data, headers: { origin } });
    expect(reply.status(), path).toBe(201);
    return ((await reply.json()) as { id: string }).id;
  };
  const checking = await post('/api/accounts', {
    type: 'bank',
    name: `Checking ${tag}`,
    currency: 'USD',
    opening: { amount: 100000, date: '2026-01-01' },
  });
  const card = await post('/api/accounts', {
    type: 'credit_card',
    name: `Card ${tag}`,
    currency: 'USD',
    creditLimit: 500000,
    opening: { amount: -42000, date: '2026-01-01' },
  });
  const euro = await post('/api/accounts', { type: 'bank', name: `Euro ${tag}`, currency: 'EUR' });
  const category = await post('/api/categories', { name: `Food ${tag}`, currency: 'USD' });
  const subcategory = await post(`/api/categories/${category}/subcategories`, {
    name: `Groceries ${tag}`,
  });
  return {
    checking,
    card,
    euro,
    subcategory,
    names: {
      checking: `Checking ${tag}`,
      card: `Card ${tag}`,
      euro: `Euro ${tag}`,
      sub: `Groceries ${tag}`,
    },
  };
}

test('pays a card from checking: both balances move, in words', async ({ page, browserName }) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `card ${browserName}`);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await dialog.getByRole('radio', { name: 'Transfer' }).click();
  await dialog.getByLabel('From').selectOption({ label: `${f.names.checking} · USD` });
  await dialog.getByLabel(/^To\b/).selectOption({ label: `${f.names.card} · USD` });
  await dialog.getByLabel('Amount').fill('250');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`/accounts/${f.checking}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$750.00');
  await page.goto(`/accounts/${f.card}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$170.00 used');
  await expect(page.getByRole('region', { name: 'Entries' })).toContainText('Transfer');
});

test('keeps both amounts of a transfer between currencies, and shows their rate', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `fx ${browserName}`);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await dialog.getByRole('radio', { name: 'Transfer' }).click();
  await dialog.getByLabel('From').selectOption({ label: `${f.names.checking} · USD` });
  await dialog.getByLabel(/^To\b/).selectOption({ label: `${f.names.euro} · EUR` });
  await dialog.getByLabel(/^Amount sent/).fill('100');
  // Without what arrived it is refused before it is sent.
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toContainText('Enter the amount that arrived.');
  await dialog.getByLabel(/^Amount received/).fill('90');
  await expect(dialog).toContainText('1 USD = 0.9 EUR');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`/accounts/${f.checking}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$900.00');
  await page.goto(`/accounts/${f.euro}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('€90.00');

  // Opened again it is the same transfer, with both amounts.
  await page
    .getByRole('button', { name: /Edit the entry of/ })
    .first()
    .click();
  const edit = page.getByRole('dialog', { name: 'Edit entry' });
  await expect(edit.getByLabel(/^Amount sent/)).toHaveValue(/^100(\.00)?$/);
  await expect(edit.getByLabel(/^Amount received/)).toHaveValue(/^90(\.00)?$/);
});

test('puts money back with a refund: the account goes up', async ({ page, browserName }) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `refund ${browserName}`);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await dialog.getByLabel('Account').selectOption({ label: `${f.names.checking} · USD` });
  await dialog.getByLabel('Subcategory').selectOption({ label: f.names.sub });
  await dialog.getByLabel(/^Amount/).fill('30');
  await dialog.getByLabel('This is money back (a refund)').check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto(`/accounts/${f.checking}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$1,030.00');
});
