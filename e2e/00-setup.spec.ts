import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * The setup wizard (task 9.1, DESIGN.md §15.3). This file is named to run first: the instance has the one account, and it is set up by the first test that
 * finishes the wizard, so the walk through it from the front address is only possible once. Later tests, and the other browser, find the book set up.
 */
test('takes a new book through four steps to Overview, making only what was chosen', async ({
  page,
}) => {
  await signedIn(page, { setup: false });
  await page.goto('/');
  // The redirect to the wizard may come after the page has loaded.
  await page.waitForURL(/\/setup$/, { timeout: 5_000 }).catch(() => undefined);
  test.skip(
    !/\/setup$/.test(page.url()),
    'the book was set up by an earlier test on this instance',
  );

  await expect(page.getByRole('heading', { level: 1, name: 'Set up your budget' })).toBeVisible();
  // Step 1: the currency is guessed from the browser's locale, and confirmed.
  const currency = page.getByRole('form', { name: 'Currency' });
  await expect(currency).toBeVisible();
  await expect(currency).toContainText('USD');
  await currency.getByRole('button', { name: 'Continue' }).click();

  // Step 2: the first account and what is in it.
  const account = page.getByRole('form', { name: 'First account' });
  await account.getByLabel('Name').fill('Wizard bank');
  await account.getByLabel('What is in it today').fill('250');
  await account.getByRole('button', { name: 'Continue' }).click();

  // Step 3: the main income.
  const income = page.getByRole('form', { name: 'Income' });
  await expect(income.getByLabel('Name')).toHaveValue('Salary');
  await income.getByLabel('Name').fill('Wizard pay');
  await income.getByLabel('Each month').fill('3000');
  await income.getByRole('button', { name: 'Continue' }).click();

  // Step 4: only the categories tapped are made.
  const categories = page.getByRole('form', { name: 'Categories' });
  await categories.getByLabel('Groceries').check();
  await categories.getByLabel('Budgeted a month for Groceries').fill('400');
  await categories.getByLabel('Fun').check();
  await categories.getByRole('button', { name: 'Finish' }).click();

  // Overview, at the front address.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // What was written is real: the account with its balance, the category with its budget, and none that was not tapped.
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: /Wizard bank/ })).toContainText('$250.00');
  await page.goto('/budget/categories');
  await expect(page.getByRole('region', { name: 'Groceries', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Fun', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Housing', exact: true })).toHaveCount(0);
  await page.goto('/budget');
  await expect(
    page.getByRole('region', { name: 'Spending' }).getByRole('link', { name: /Groceries/ }),
  ).toContainText('of $400.00');
  await page.goto('/budget/income');
  await expect(page.getByRole('region', { name: 'Wizard pay', exact: true })).toContainText(
    'Budgeted $3,000.00',
  );
});

test('is safe to go back and forward in: nothing is made twice, and what was entered is still there', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/setup');
  // The first account made is shown, and going back and forward over it makes no other.
  const strip = page.getByRole('button', { name: /^2\. First account/ });
  await strip.click();
  await expect(page.getByText(/is made, with/)).toBeVisible();
  const accounts = async () =>
    (await (await page.request.get('/api/accounts')).json()) as { accounts: { name: string }[] };
  const before = (await accounts()).accounts.length;
  await page.getByRole('button', { name: 'Back' }).click();
  await page
    .getByRole('form', { name: 'Currency' })
    .getByRole('button', { name: 'Continue' })
    .click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByRole('form', { name: 'Income' })
    .getByRole('button', { name: 'Continue' })
    .click();
  await expect(page.getByRole('form', { name: 'Categories' })).toBeVisible();
  expect((await accounts()).accounts.length).toBe(before);
  // A refresh in the middle loses nothing: the book is read again.
  await page.reload();
  await expect(page.getByRole('form', { name: 'Categories' })).toBeVisible();
  expect((await accounts()).accounts.length).toBe(before);
});

test('can be skipped: a person with a book of their own goes on to Overview', async ({ page }) => {
  await signedIn(page);
  await page.goto('/setup');
  await page.getByRole('button', { name: /Skip setup/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
});
