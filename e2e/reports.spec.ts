import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Reports (task 8.1, DESIGN.md §11): the list of months with the current one in progress, and a month's report with its income, its spending by category
 * against the budget and the savings figures. Fixtures are made through the app's own routes with its own `Origin`.
 */
test('shows a month’s income, spending against the budget and what was saved, and lists the months', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `report ${browserName}`;
  // A month of its own for each browser, and one no other test writes to, since all of them run against one instance and a month's figures are the book's.
  const month = browserName === 'webkit' ? '2018-04' : '2018-03';
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const reply = await page.request.post(path, { data, headers: { origin } });
    expect(reply.status(), path).toBe(201);
    return ((await reply.json()) as { id: string }).id;
  };
  // The totals are in the base currency: the book has one by now, and this says so when this file runs alone.
  const setup = await page.request.post('/api/setup', {
    data: { step: 'currency', currency: 'USD' },
    headers: { origin },
  });
  expect(setup.status()).toBe(200);
  const account = await post('/api/accounts', {
    type: 'bank',
    name: `Bank ${tag}`,
    currency: 'USD',
    opening: { amount: 500_000, date: '2017-12-01' },
  });
  const source = await post('/api/income-sources', { name: `Pay ${tag}`, kind: 'secondary' });
  const category = await post('/api/categories', { name: `Home ${tag}`, currency: 'USD' });
  const groceries = await post(`/api/categories/${category}/subcategories`, {
    name: `Groceries ${tag}`,
  });
  const budget = await page.request.post('/api/budget', {
    data: { kind: 'subcategory', id: groceries, amount: 30_000, when: 'this' },
    headers: { origin },
  });
  expect(budget.status()).toBe(200);
  await post('/api/transactions', {
    type: 'income',
    date: `${month}-01`,
    lines: [
      { account, amount: 100_000, currency: 'USD' },
      { incomeSource: source, amount: -100_000, currency: 'USD' },
    ],
  });
  await post('/api/transactions', {
    type: 'expense',
    date: `${month}-10`,
    lines: [
      { account, amount: -20_000, currency: 'USD' },
      { subcategory: groceries, amount: 20_000, currency: 'USD' },
    ],
  });

  await page.goto(`/reports?month=${month}`);
  await expect(page.getByRole('heading', { level: 1, name: `Report for ${month}` })).toBeVisible();
  const income = page.getByRole('region', { name: 'Income and saving' });
  await expect(income).toContainText('$1,000.00');
  await expect(income).toContainText('$200.00');
  const spending = page.getByRole('region', { name: 'Spending by category' });
  const row = spending.getByRole('row').filter({ hasText: `Groceries ${tag}` });
  await expect(row).toContainText('$200.00');
  await expect(spending.getByRole('row').filter({ hasText: `Home ${tag}` })).toContainText(
    '$200.00',
  );

  // The list: this month is in progress, and a month opens its report.
  await page.goto('/reports');
  const months = page.getByRole('table', { name: 'Months' });
  await expect(months).toContainText('In progress');
  await months.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/reports\?month=\d{4}-\d{2}$/);

  // The year: the same month inside it, by category.
  await page.goto('/reports?year=2018');
  await expect(page.getByRole('heading', { level: 1, name: 'Report for 2018' })).toBeVisible();
  const year = page.getByRole('region', { name: 'Spent by category and month' });
  await expect(year.getByRole('row').filter({ hasText: `Groceries ${tag}` })).toContainText(
    '$200.00',
  );
  await expect(page.getByRole('region', { name: 'Months' })).toContainText(month);
});

test('shows net worth at each month end on Accounts and in Reports', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const origin = new URL(page.url()).origin;
  const setup = await page.request.post('/api/setup', {
    data: { step: 'currency', currency: 'USD' },
    headers: { origin },
  });
  expect(setup.status()).toBe(200);
  const made = await page.request.post('/api/accounts', {
    data: {
      type: 'bank',
      name: `Worth ${browserName}`,
      currency: 'USD',
      opening: { amount: 123_456, date: '2019-06-01' },
    },
    headers: { origin },
  });
  expect(made.status()).toBe(201);
  for (const path of ['/accounts', '/reports']) {
    await page.goto(path);
    const table = page.getByRole('region', { name: 'Net worth by month end' });
    await expect(table).toBeVisible();
    // The latest month end is first, and holds at least what this account holds.
    await expect(table.getByRole('row').nth(1)).toContainText('$');
    await expect(table.getByRole('row')).toHaveCount(13);
  }
});

test('marks a month reviewed and undoes it, and Overview says which month needs its review', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const origin = new URL(page.url()).origin;
  await page.request.post('/api/setup', {
    data: { step: 'currency', currency: 'USD' },
    headers: { origin },
  });
  // A book that has been through months: an entry long ago.
  const account = await page.request.post('/api/accounts', {
    data: {
      type: 'bank',
      name: `Review ${browserName}`,
      currency: 'USD',
      opening: { amount: 1_000, date: '2019-01-01' },
    },
    headers: { origin },
  });
  expect(account.status()).toBe(201);

  await page.goto('/');
  const banner = page.getByRole('status').filter({ hasText: 'needs its review' });
  await expect(banner).toBeVisible();
  const shown = ((await banner.textContent()) ?? '').match(/\d{4}-\d{2}/)?.[0] as string;
  await banner.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/reports\\?month=${shown}$`));

  const review = page.getByRole('region', { name: 'Review' });
  await expect(review).toContainText('needs review');
  await review.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(review).toContainText('This month is reviewed.');
  await expect(review.getByRole('link', { name: /^Adjust budgets for/ })).toBeVisible();

  // The banner moves back to an earlier month; the list says reviewed.
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'needs its review' })).not.toContainText(
    shown,
  );
  await page.goto('/reports');
  await expect(page.getByRole('row').filter({ hasText: shown }).first()).toContainText('Reviewed');

  // Undone, it returns.
  await page.goto(`/reports?month=${shown}`);
  await page
    .getByRole('region', { name: 'Review' })
    .getByRole('button', { name: 'Undo review' })
    .click();
  await expect(page.getByRole('region', { name: 'Review' })).toContainText('needs review');
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'needs its review' })).toContainText(
    shown,
  );
});
