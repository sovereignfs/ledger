import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Recurring entries (task 6.2, DESIGN.md §8.2): "Repeat…" in an entry's dialog makes it repeat, and the Bills page shows it, switches whether it posts
 * itself or asks first, and ends it. The server's job posting what is due is the data layer's tests; here is what a person does.
 */
async function entry(page: Page, tag: string, date: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const reply = await page.request.post(path, { data, headers: { origin } });
    expect(reply.status(), path).toBe(201);
    return ((await reply.json()) as { id: string }).id;
  };
  const account = await post('/api/accounts', {
    type: 'bank',
    name: `Bank ${tag}`,
    currency: 'USD',
  });
  const category = await post('/api/categories', { name: `Home ${tag}`, currency: 'USD' });
  const subcategory = await post(`/api/categories/${category}/subcategories`, {
    name: `Rent ${tag}`,
  });
  await post('/api/transactions', {
    type: 'expense',
    date,
    payee: `Landlord ${tag}`,
    lines: [
      { account, amount: -90_000, currency: 'USD' },
      { subcategory, amount: 90_000, currency: 'USD' },
    ],
  });
  return account;
}

test('makes an entry repeat from its dialog, then switches it to asking first, and ends it', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `repeat ${browserName}`;
  const date = '2020-03-16';
  const account = await entry(page, tag, date);

  await page.goto(`/accounts/${account}`);
  await page
    .getByRole('button', { name: `Edit the entry of ${date}` })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Edit entry' });
  await dialog.getByRole('button', { name: 'Repeat…' }).click();
  await dialog.getByLabel('Unit').selectOption('week');
  await dialog.getByLabel(/^Every/).fill('2');
  await dialog.getByRole('button', { name: 'Repeat this entry' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/budget/bills');
  const row = page.getByRole('listitem').filter({ hasText: `Landlord ${tag}` });
  await expect(row).toContainText('$900.00');
  await expect(row).toContainText('Every 2 weeks');
  await expect(row).toContainText('Posts itself');

  await row.getByRole('button', { name: `Ask first: Landlord ${tag}` }).click();
  await expect(row).toContainText('Asks first');

  await row.getByRole('button', { name: `End Landlord ${tag}` }).click();
  await row.getByRole('button', { name: 'End for good' }).click();
  await expect(row).toContainText('Ended');
  await expect(row.getByRole('button', { name: 'Ask first' })).toHaveCount(0);
});

test('says why an entry that repeats already cannot be made to repeat again', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `again ${browserName}`;
  const date = '2020-04-16';
  const account = await entry(page, tag, date);
  await page.goto(`/accounts/${account}`);
  const repeat = async () => {
    await page
      .getByRole('button', { name: `Edit the entry of ${date}` })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Edit entry' });
    await dialog.getByRole('button', { name: 'Repeat…' }).click();
    await dialog.getByRole('button', { name: 'Repeat this entry' }).click();
    return dialog;
  };
  await expect(await repeat()).toBeHidden();
  await page.reload();
  const again = await repeat();
  await expect(again.getByRole('alert')).toBeVisible();
});
