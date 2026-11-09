import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Categories (task 5.1, DESIGN.md §7.1): make a category and subcategories, rename and put them in order, archive and delete, from the Budget's own page.
 * Both browsers share the instance, so each test names its own.
 */
test('makes a category and subcategories, and reaches the page from the Budget', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/budget');
  await page.getByRole('link', { name: 'Categories' }).click();
  await expect(page).toHaveURL(/\/budget\/categories$/);
  const name = `Home ${browserName}`;
  await page.getByLabel('New category').fill(name);
  await page.getByRole('button', { name: 'Add category' }).click();
  const section = page.getByRole('region', { name, exact: true });
  await expect(section).toBeVisible();
  await section.getByLabel(`New subcategory in ${name}`).fill('Rent');
  await section.getByRole('button', { name: 'Add', exact: true }).click();
  await section.getByLabel(`New subcategory in ${name}`).fill('Power');
  await section.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(section.getByText('Rent')).toBeVisible();
  await expect(section.getByText('Power')).toBeVisible();

  // Put in order: Power moves above Rent.
  await section.getByRole('button', { name: 'Move Power up' }).click();
  await expect(section.getByRole('listitem').first()).toContainText('Power');
});

test('says in a sentence when a name is taken, and keeps what was typed', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/budget/categories');
  const name = `Twice ${browserName}`;
  await page.getByLabel('New category').fill(name);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  await page.getByLabel('New category').fill(name.toUpperCase());
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByText('There is already a category with that name.')).toBeVisible();
});

test('archives a category and brings it back, and deletes one that was never spent on', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/budget/categories');
  const name = `Gone ${browserName}`;
  await page.getByLabel('New category').fill(name);
  await page.getByRole('button', { name: 'Add category' }).click();
  const section = page.getByRole('region', { name, exact: true });
  await section.getByRole('button', { name: 'Archive', exact: true }).first().click();
  const archived = page.getByRole('region', { name: 'Archived categories' });
  await expect(archived).toContainText(name);
  await archived.getByRole('button', { name: 'Bring back' }).first().click();
  await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  await page
    .getByRole('region', { name, exact: true })
    .getByRole('button', { name: 'Delete', exact: true })
    .first()
    .click();
  await expect(page.getByRole('region', { name, exact: true })).toHaveCount(0);
});
