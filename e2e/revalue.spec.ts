import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Giving an investment a value (task 4.9, DESIGN.md §6.6): a fund valued at 10,500 from 10,000 is worth 500 more, the change is in its value history, and the
 * dialog says before it records anything that it is neither income nor spending. Fixtures are made through the app's own routes with its own `Origin`.
 */
test('values a fund: 10,000 to 10,500 is a change of 500, in the history, and a bank account has no such button', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const origin = new URL(page.url()).origin;
  const post = async (data: unknown) => {
    const reply = await page.request.post('/api/accounts', { data, headers: { origin } });
    expect(reply.status()).toBe(201);
    return ((await reply.json()) as { id: string }).id;
  };
  const fund = await post({
    type: 'investment',
    name: `Fund ${browserName}`,
    currency: 'USD',
    opening: { amount: 1_000_000, date: '2026-01-01' },
  });
  const bank = await post({ type: 'bank', name: `Bank ${browserName}`, currency: 'USD' });

  await page.goto(`/accounts/${bank}`);
  await expect(page.getByRole('button', { name: 'Update value' })).toHaveCount(0);

  await page.goto(`/accounts/${fund}`);
  await page.getByRole('button', { name: 'Update value' }).click();
  const dialog = page.getByRole('dialog', { name: 'Update value' });
  await dialog.getByLabel(/^Worth/).fill('10500');
  await expect(dialog).toContainText(
    'a change of $500.00 will be recorded, which is neither income nor spending',
  );
  await dialog.getByRole('button', { name: 'Update value', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Valued at' })).toContainText(
    'a change of $500.00 recorded',
  );
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$10,500.00');
  const history = page.getByRole('region', { name: 'Value history' });
  await expect(history).toContainText('$500.00');
  await expect(history).toContainText('$10,500.00');
  await expect(page.getByRole('region', { name: 'Entries' })).toContainText('Value updated');
});
