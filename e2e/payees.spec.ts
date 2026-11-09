import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Payees (task 4.5, DESIGN.md §6.5): a name typed in the add dialog is remembered and then proposed, with the subcategory last used with it; and the payees
 * page renames, merges and archives them. Fixtures are made through the app's own routes with its own `Origin`.
 */
async function fixtures(page: Page, tag: string) {
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
  const category = await post('/api/categories', { name: `Food ${tag}`, currency: 'USD' });
  const subcategory = await post(`/api/categories/${category}/subcategories`, {
    name: `Groceries ${tag}`,
  });
  const spend = (payee: string, amount: number) =>
    post('/api/transactions', {
      type: 'expense',
      date: '2026-11-06',
      payee,
      lines: [
        { account, amount: -amount, currency: 'USD' },
        { subcategory, amount, currency: 'USD' },
      ],
    });
  return { account, subcategory, spend, name: `Bank ${tag}`, sub: `Groceries ${tag}`, origin };
}

test('proposes the subcategory last used with a payee when it is picked', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `propose ${browserName}`);
  const payee = `Corner Shop ${browserName}`;
  await f.spend(payee, 1250);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await expect(dialog.getByLabel('Subcategory')).toHaveValue('');
  await dialog
    .getByRole('combobox', { name: 'Payee' })
    .fill(`corner shop ${browserName}`.slice(0, 12));
  await page.getByRole('option', { name: payee }).click();
  await expect(dialog.getByRole('combobox', { name: 'Payee' })).toHaveValue(payee);
  await expect(dialog.getByLabel('Subcategory')).toHaveValue(f.subcategory);
  await expect(dialog.getByLabel('Account')).toHaveValue(f.account);

  // A new name is made on save, and is there next time.
  await dialog.getByLabel(/^Amount/).fill('3');
  await dialog.getByRole('combobox', { name: 'Payee' }).fill(`Brand New ${browserName}`);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/payees');
  await expect(
    page.getByRole('link', { name: new RegExp(`Brand New ${browserName}`) }),
  ).toBeVisible();
});

test('renames, merges and archives payees, and a payee shows its months', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `manage ${browserName}`);
  const keep = `Keep ${browserName}`;
  const gone = `Gone ${browserName}`;
  await f.spend(keep, 1000);
  await f.spend(gone, 2000);
  await f.spend(gone, 500);
  await page.goto('/payees');
  await expect(page.getByRole('link', { name: new RegExp(`${gone}.*2 entries`) })).toBeVisible();

  await page.getByRole('button', { name: `Merge ${gone} into another` }).click();
  await page.getByLabel(`Merge ${gone} into`, { exact: true }).selectOption({ label: keep });
  await page.getByRole('button', { name: 'Merge…' }).click();
  await page.getByRole('button', { name: 'Merge for good' }).click();
  await expect(page.getByRole('link', { name: new RegExp(gone) })).toHaveCount(0);
  await expect(page.getByRole('link', { name: new RegExp(`${keep}.*3 entries`) })).toBeVisible();

  await page.getByRole('link', { name: new RegExp(keep) }).click();
  await expect(page.getByRole('heading', { level: 1, name: keep })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Totals by month' })).toContainText('2026-11');
  await expect(page.getByRole('region', { name: 'Totals by month' })).toContainText('$35.00');

  await page.goto('/payees');
  await page.getByRole('button', { name: `Rename ${keep}` }).click();
  const rename = page.getByRole('form', { name: `Rename ${keep}` });
  await rename.getByLabel('Name', { exact: true }).fill(`Kept ${browserName}`);
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: new RegExp(`Kept ${browserName}`) })).toBeVisible();
  await page.getByRole('button', { name: `Archive Kept ${browserName}` }).click();
  await expect(page.getByRole('link', { name: new RegExp(`Kept ${browserName}`) })).toHaveCount(0);
  await page.goto('/payees?archived=1');
  await expect(page.getByRole('link', { name: new RegExp(`Kept ${browserName}`) })).toBeVisible();
});
