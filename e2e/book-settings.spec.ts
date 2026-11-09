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
  // Kept: a fresh load shows it. The page refreshes itself after a save, so a load made in the middle of that is made again.
  await expect(async () => {
    await page.goto('/account?section=book');
    const again = page
      .getByRole('region', { name: 'Book', exact: true })
      .getByRole('form', { name: 'Book settings' });
    await expect(again.getByLabel(/^Name/)).toHaveValue(name, { timeout: 2_000 });
    await expect(again.getByLabel('First day of the week')).toHaveValue('0', { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // A currency, by itself: one for each browser, since both run against one instance and one that is in the book is not offered again.
  const code = browserName === 'webkit' ? 'SEK' : 'NOK';
  await page.goto('/account?section=currencies');
  const currencies = page.getByRole('region', { name: 'Currencies', exact: true });
  const list = currencies.getByRole('list', { name: 'Currencies in this book' });
  // One that is in the book is not offered again, so a second attempt after a failure of the first (CI tries twice) does not add it twice.
  if (!((await list.textContent()) ?? '').includes(code)) {
    await currencies.getByLabel('Currency to add').click();
    await page.getByRole('option', { name: new RegExp(`^${code}`) }).click();
    await currencies.getByRole('button', { name: 'Add currency' }).click();
  }
  await expect(list).toContainText(code);

  // The recap.
  await page.goto('/account?section=notifications');
  const recap = page
    .getByRole('region', { name: 'Notifications', exact: true })
    .getByLabel('Send me a recap of each month');
  await recap.uncheck();
  await expect(async () => {
    await page.goto('/account?section=notifications');
    await expect(
      page
        .getByRole('region', { name: 'Notifications', exact: true })
        .getByLabel('Send me a recap of each month'),
    ).not.toBeChecked({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page
    .getByRole('region', { name: 'Notifications', exact: true })
    .getByLabel('Send me a recap of each month')
    .check();
});
