import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * The Budget screen (task 5.4, DESIGN.md §7.2): a month's budgeted and spent per subcategory, a split counted in both rows, a budget set from this month or
 * from next, and a selected row's entries and history. Fixtures are made through the app's own routes with its own `Origin`.
 */
async function fixtures(page: Page, tag: string) {
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const reply = await page.request.post(path, { data, headers: { origin } });
    expect(reply.status(), path).toBe(201);
    return ((await reply.json()) as { id: string }).id;
  };
  const bank = await post('/api/accounts', {
    type: 'bank',
    name: `Bank ${tag}`,
    currency: 'USD',
    opening: { amount: 1_000_000, date: '2020-01-01' },
  });
  const category = await post('/api/categories', { name: `Food ${tag}`, currency: 'USD' });
  const groceries = await post(`/api/categories/${category}/subcategories`, {
    name: `Groceries ${tag}`,
  });
  const movies = await post(`/api/categories/${category}/subcategories`, { name: `Movies ${tag}` });
  const today = new Date().toISOString().slice(0, 10);
  await post('/api/transactions', {
    type: 'expense',
    date: today,
    lines: [
      { account: bank, amount: -8420, currency: 'USD' },
      { subcategory: groceries, amount: 6100, currency: 'USD' },
      { subcategory: movies, amount: 2320, currency: 'USD' },
    ],
  });
  return { groceries, movies, names: { groceries: `Groceries ${tag}`, movies: `Movies ${tag}` } };
}

test('shows a split in both rows, and says when a row is over', async ({ page, browserName }) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `bsplit ${browserName}`);
  await page.goto('/budget');
  const spending = page.getByRole('region', { name: 'Spending' });
  await expect(spending.getByRole('link', { name: new RegExp(f.names.groceries) })).toContainText(
    '$61.00 of no budget',
  );
  await expect(spending.getByRole('link', { name: new RegExp(f.names.movies) })).toContainText(
    '$23.20 of no budget',
  );

  // A budget set from this month shows on the row, and over it is said in words.
  await page.goto(`/budget?row=${f.movies}`);
  const detail = page.getByRole('region', { name: new RegExp(`${f.names.movies} in`) });
  await detail.getByLabel(`Budgeted amount for ${f.names.movies}`).fill('20');
  await detail.getByRole('button', { name: 'Set budget' }).click();
  await expect(detail).toContainText('Set from this month.');
  await expect(
    page
      .getByRole('region', { name: 'Spending' })
      .getByRole('link', { name: new RegExp(f.names.movies) }),
  ).toContainText('Over by $3.20');
  await expect(
    page.getByRole('region', { name: new RegExp(`${f.names.movies} in`) }),
  ).toContainText('$20.00');
  await expect(
    page.getByRole('region', { name: new RegExp(`${f.names.movies} in`) }),
  ).toContainText('$23.20');
});

test('sets a budget from next month: this month keeps what it had, and next month has the new one in its history', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `bnext ${browserName}`);
  await page.goto(`/budget?row=${f.groceries}`);
  let detail = page.getByRole('region', { name: new RegExp(`${f.names.groceries} in`) });
  await detail.getByLabel(`Budgeted amount for ${f.names.groceries}`).fill('400');
  await detail.getByRole('button', { name: 'Set budget' }).click();
  await expect(detail).toContainText('Set from this month.');
  await detail.getByLabel(`Budgeted amount for ${f.names.groceries}`).fill('450');
  await detail.getByLabel(`From, for ${f.names.groceries}`).selectOption('next');
  await detail.getByRole('button', { name: 'Set budget' }).click();
  await expect(detail).toContainText('Set from next month.');
  detail = page.getByRole('region', { name: new RegExp(`${f.names.groceries} in`) });
  await expect(detail.getByRole('row', { name: /\$400\.00/ })).toBeVisible();
  await expect(detail.getByRole('row', { name: /\$450\.00/ })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Spending' })
      .getByRole('link', { name: new RegExp(f.names.groceries) }),
  ).toContainText('of $400.00');
  await page.getByRole('link', { name: 'Later' }).click();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}$/);
  await expect(
    page
      .getByRole('region', { name: 'Spending' })
      .getByRole('link', { name: new RegExp(f.names.groceries) }),
  ).toContainText('of $450.00');
  // Ending a budget writes a zero from a month.
  await page.goto(`/budget?row=${f.groceries}`);
  detail = page.getByRole('region', { name: new RegExp(`${f.names.groceries} in`) });
  await detail.getByRole('button', { name: 'End budget' }).click();
  await expect(detail).toContainText('Ended from this month.');
  await expect(detail.getByRole('row', { name: /Ended/ })).toBeVisible();
});

test('opens a row to its entries this month, with only its own part of a split', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `bentries ${browserName}`);
  await page.goto(`/budget?row=${f.movies}`);
  const detail = page.getByRole('region', { name: new RegExp(`${f.names.movies} in`) });
  await expect(detail.getByRole('table').last()).toContainText('$23.20');
  await expect(detail.getByRole('table').last()).not.toContainText('$84.20');
  await expect(detail.getByRole('link', { name: 'All its entries' })).toHaveAttribute(
    'href',
    new RegExp(`subcategory=${f.movies}`),
  );
});

test('has an empty state that leads to the categories', async ({ page }) => {
  await signedIn(page);
  await page.goto('/budget');
  await expect(page.getByRole('link', { name: 'Categories' }).first()).toBeVisible();
  await expect(
    page.getByRole('region', { name: /^Totals for / }).or(page.getByText('No categories yet')),
  ).toBeVisible();
});
