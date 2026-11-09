import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Accounts (task 4.1, DESIGN.md §6.1): add one with what is in it, see it listed and its page, owe money on a card and read it in words and not with a minus,
 * archive it, and delete one that has nothing but its opening balance. Both browsers share the instance, so each test makes accounts with names of its own.
 */
test('adds an account with an opening balance, and shows it in the list and on its own page', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Add account' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add account' });
  await dialog.getByLabel('Name').fill(`Everyday ${browserName}`);
  await dialog.getByLabel('Institution').fill('First Bank');
  await dialog.getByLabel('What is in it').fill('1234.56');
  await dialog.getByRole('button', { name: 'Add account' }).click();

  // Its own page, with the balance and the opening entry.
  await expect(
    page.getByRole('heading', { level: 1, name: `Everyday ${browserName}` }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$1,234.56');
  await expect(page.getByRole('region', { name: 'Entries' })).toContainText('Opening balance');

  // And in the list, under what you have.
  await page.goto('/accounts');
  const have = page.getByRole('region', { name: 'What you have' });
  await expect(
    have.getByRole('link', { name: new RegExp(`Everyday ${browserName}`) }),
  ).toContainText('$1,234.56');
  await expect(page.getByRole('region', { name: 'Net worth' })).toBeVisible();
});

test('says what is owed in words, never with a minus', async ({ page, browserName }) => {
  await signedIn(page);
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Add account' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add account' });
  await dialog.getByLabel('Kind').selectOption('credit_card');
  await dialog.getByLabel('Name').fill(`Card ${browserName}`);
  await dialog.getByLabel('Credit limit').fill('5000');
  await dialog.getByLabel('Owed now').fill('420');
  await dialog.getByRole('button', { name: 'Add account' }).click();
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toContainText('$420.00 used');
  await expect(summary).toContainText('$4,580.00');
  await expect(summary).not.toContainText('-$');
  await expect(summary).not.toContainText('−');
  await page.goto('/accounts');
  const owe = page.getByRole('region', { name: 'What you owe' });
  await expect(owe.getByRole('link', { name: new RegExp(`Card ${browserName}`) })).toContainText(
    '$420.00 used',
  );
  await expect(owe).not.toContainText('-$');
});

test('archives an account out of the list and brings it back; deletes one with nothing but its opening', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Add account' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add account' });
  await dialog.getByLabel('Name').fill(`Spare ${browserName}`);
  await dialog.getByLabel('What is in it').fill('10');
  await dialog.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Spare ${browserName}` })).toBeVisible();
  const url = page.url();

  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Bring back' })).toBeVisible();
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: new RegExp(`Spare ${browserName}`) })).toHaveCount(0);
  await page.goto('/accounts?archived=1');
  await expect(page.getByRole('link', { name: new RegExp(`Spare ${browserName}`) })).toBeVisible();

  await page.goto(url);
  await page.getByRole('button', { name: 'Bring back' }).click();
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('link', { name: new RegExp(`Spare ${browserName}`) })).toHaveCount(0);
  // A page that streams cannot change its status after it has started, so a missing account is told by what the page says.
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: `Spare ${browserName}` })).toHaveCount(
    0,
  );
  await expect(page.getByText('That is not here').first()).toBeVisible();
});

test('shows a sentence, and keeps the dialog, when an account is refused', async ({ page }) => {
  await signedIn(page);
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Add account' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add account' });
  await dialog.getByLabel('Kind').selectOption('loan');
  await dialog.getByLabel('Name').fill('Loan that ends first');
  await dialog.getByLabel('Lender').fill('Credit Union');
  await dialog.getByLabel('Borrowed').fill('100');
  await dialog.getByLabel('Each instalment').fill('10');
  await dialog.getByLabel('Started').fill('2026-06-01');
  await dialog.getByLabel('Ends').fill('2026-01-01');
  await dialog.getByRole('button', { name: 'Add account' }).click();
  await expect(dialog).toContainText('A loan does not end before it starts.');
  await expect(dialog).toBeVisible();
});
