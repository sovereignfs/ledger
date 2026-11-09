import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * The add dialog (task 4.3, DESIGN.md §14.4): an expense logged from any page with the keyboard, a form that is blank when it is reopened, a refusal that
 * opens the dialog again with what was typed and the reason, and an entry changed and deleted from the same dialog. Fixtures are made through the app's own
 * routes, with its own `Origin`, since the screens that make them are tested in their own files.
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
    opening: { amount: 100000, date: '2026-01-01' },
  });
  const category = await post('/api/categories', { name: `Food ${tag}`, currency: 'USD' });
  const subcategory = await post(`/api/categories/${category}/subcategories`, {
    name: `Groceries ${tag}`,
  });
  return { account, category, subcategory, origin, name: `Bank ${tag}`, sub: `Groceries ${tag}` };
}

test('logs an expense from any page with the keyboard, and the account shows it', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/budget');
  const f = await fixtures(page, `kb ${browserName}`);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Account').selectOption({ label: `${f.name} · USD` });
  await dialog.getByLabel('Subcategory').selectOption({ label: f.sub });
  await dialog.getByLabel('Amount').click();
  await page.keyboard.type('12.50');
  await dialog.getByLabel('Note').click();
  await page.keyboard.type('lunch');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(/Saving|Saved/);

  await page.goto(`/accounts/${f.account}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$987.50');
  await expect(page.getByRole('region', { name: 'Entries' })).toContainText('Expense · lunch');
});

test('opens blank when it is opened again, except for the account it remembers', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `blank ${browserName}`);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await dialog.getByLabel('Account').selectOption({ label: `${f.name} · USD` });
  await dialog.getByLabel('Subcategory').selectOption({ label: f.sub });
  await dialog.getByLabel('Amount').fill('5');
  await dialog.getByLabel('Note').fill('typed');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const again = page.getByRole('dialog', { name: 'Add entry' });
  await expect(again.getByLabel('Amount')).toHaveValue('');
  await expect(again.getByLabel('Note')).toHaveValue('');
  await expect(again.getByLabel('Subcategory')).toHaveValue('');
  await expect(again.getByLabel('Account')).toHaveValue(f.account);
});

test('opens again with what was typed, and the reason, when a save is refused', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `refuse ${browserName}`);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await dialog.getByLabel('Account').selectOption({ label: `${f.name} · USD` });
  await dialog.getByLabel('Subcategory').selectOption({ label: f.sub });
  await dialog.getByLabel('Amount').fill('42');
  await dialog.getByLabel('Note').fill('keep me');
  // The subcategory is archived elsewhere while the dialog is open.
  const archived = await page.request.patch(`/api/subcategories/${f.subcategory}`, {
    data: { archived: true },
    headers: { origin: f.origin },
  });
  expect(archived.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const back = page.getByRole('dialog', { name: 'Add entry' });
  await expect(back).toContainText('A subcategory is archived');
  await expect(back.getByLabel('Note')).toHaveValue('keep me');
  await expect(back.getByLabel('Amount')).toHaveValue(/^42(\.00)?$/);
});

test('says which month a date counts towards, and edits and deletes an entry from the same dialog', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `edit ${browserName}`);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await dialog.getByLabel('Account').selectOption({ label: `${f.name} · USD` });
  await dialog.getByLabel('Subcategory').selectOption({ label: f.sub });
  await dialog.getByLabel('Amount').fill('10');
  await dialog.getByLabel('Date').fill('2020-03-15');
  await expect(dialog).toContainText('This counts towards March 2020.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`/accounts/${f.account}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$990.00');
  await page.getByRole('button', { name: 'Edit the entry of 2020-03-15' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit entry' });
  await expect(edit.getByLabel('Amount')).toHaveValue('10.00');
  await edit.getByLabel('Amount').fill('25');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$975.00');

  await page.getByRole('button', { name: 'Edit the entry of 2020-03-15' }).click();
  await page
    .getByRole('dialog', { name: 'Edit entry' })
    .getByRole('button', { name: 'Delete…' })
    .click();
  await page
    .getByRole('dialog', { name: 'Edit entry' })
    .getByRole('button', { name: 'Delete for good' })
    .click();
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$1,000.00');
  await expect(page.getByRole('region', { name: 'Entries' })).not.toContainText('2020-03-15');
});

test('splits a payment: the remainder is shown, saving with one is refused, and it lands in both subcategories', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `split ${browserName}`);
  const second = await page.request.post(`/api/categories/${f.category}/subcategories`, {
    data: { name: `Household ${browserName}` },
    headers: { origin: f.origin },
  });
  expect(second.status()).toBe(201);
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add entry' });
  await dialog.getByLabel('Account').selectOption({ label: `${f.name} · USD` });
  await dialog.getByLabel(/^Amount(?! of part)/).fill('84.20');
  await dialog.getByLabel('Subcategory').selectOption({ label: f.sub });
  await dialog.getByRole('button', { name: 'Split' }).click();
  await dialog.getByLabel('Amount of part 1').fill('61');
  await dialog
    .getByLabel('Subcategory of part 2')
    .selectOption({ label: `Household ${browserName}` });
  await expect(dialog.getByRole('status').filter({ hasText: 'left to place' })).toContainText(
    '$84.20 left to place'.replace('84.20', '23.20'),
  );

  // With a remainder it is refused before it is sent, and says by how much.
  await dialog.getByLabel('Amount of part 2').fill('20');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toContainText('The parts are 3.20 USD short');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Amount of part 2').fill('23.20');
  await expect(dialog).toContainText('The parts add up.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`/accounts/${f.account}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$915.80');
  await expect(page.getByRole('region', { name: 'Entries' })).toContainText('Expense · Split in 2');

  // The same dialog opens it as a split.
  await page
    .getByRole('button', { name: /Edit the entry of/ })
    .first()
    .click();
  const edit = page.getByRole('dialog', { name: 'Edit entry' });
  await expect(edit.getByLabel('Amount of part 1')).toHaveValue(/^61(\.00)?$/);
  await expect(edit.getByLabel('Amount of part 2')).toHaveValue(/^23\.20$/);
});
