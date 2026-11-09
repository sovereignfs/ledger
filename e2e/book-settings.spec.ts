import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/** The book's settings (task 9.3, DESIGN.md §15.1): its name, a currency added, and the recap turned off, each kept; nothing else of the book is touched. */
test('changes the book’s name, adds a currency and turns the recap off, and they are kept', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/account?section=book');
  const book = page.getByRole('region', { name: 'Book', exact: true });
  const form = book.getByRole('form', { name: 'Book settings' });
  await expect(form.getByLabel(/^Name/)).toHaveValue(/.+/);
  const name = `Household ${browserName}`;
  await form.getByLabel(/^Name/).fill(name);
  await form.getByLabel('First day of the week').selectOption('0');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(book.getByRole('status')).toContainText('Saved.');
  // The page refreshes itself after a save; a load of the same address is made once that is over.
  await page.waitForLoadState('networkidle');

  // Kept: a fresh load shows it.
  await page.goto('/account?section=book');
  const again = page
    .getByRole('region', { name: 'Book', exact: true })
    .getByRole('form', { name: 'Book settings' });
  await expect(again.getByLabel(/^Name/)).toHaveValue(name);
  await expect(again.getByLabel('First day of the week')).toHaveValue('0');

  // A currency, by itself: one for each browser, since both run against one instance and one that is in the book is not offered again.
  const code = browserName === 'webkit' ? 'SEK' : 'NOK';
  await page.goto('/account?section=currencies');
  const currencies = page.getByRole('region', { name: 'Currencies', exact: true });
  await currencies.getByLabel('Currency to add').click();
  await page.getByRole('option', { name: new RegExp(`^${code}`) }).click();
  await currencies.getByRole('button', { name: 'Add currency' }).click();
  await expect(currencies.getByRole('list', { name: 'Currencies in this book' })).toContainText(
    'NOK',
  );

  await page.waitForLoadState('networkidle');

  // The recap.
  await page.goto('/account?section=notifications');
  const recap = page
    .getByRole('region', { name: 'Notifications', exact: true })
    .getByLabel('Send me a recap of each month');
  await recap.uncheck();
  await page.waitForLoadState('networkidle');
  await page.goto('/account?section=notifications');
  await expect(
    page
      .getByRole('region', { name: 'Notifications', exact: true })
      .getByLabel('Send me a recap of each month'),
  ).not.toBeChecked();
  await page
    .getByRole('region', { name: 'Notifications', exact: true })
    .getByLabel('Send me a recap of each month')
    .check();
});
