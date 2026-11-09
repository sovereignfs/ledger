import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * The transactions list (task 4.7, DESIGN.md §6.9): filters that live in the address and reopen the same view, the one account's running balance, and what
 * can be done to several entries at once. Fixtures are made through the app's own routes with its own `Origin`.
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
    opening: { amount: 100000, date: '2026-01-01' },
  });
  const cash = await post('/api/accounts', { type: 'cash', name: `Cash ${tag}`, currency: 'USD' });
  const category = await post('/api/categories', { name: `Food ${tag}`, currency: 'USD' });
  const groceries = await post(`/api/categories/${category}/subcategories`, {
    name: `Groceries ${tag}`,
  });
  const dining = await post(`/api/categories/${category}/subcategories`, { name: `Dining ${tag}` });
  const spend = (
    account: string,
    sub: string,
    amount: number,
    date: string,
    payee: string,
    note?: string,
  ) =>
    post('/api/transactions', {
      type: 'expense',
      date,
      payee,
      note: note ?? null,
      lines: [
        { account, amount: -amount, currency: 'USD' },
        { subcategory: sub, amount, currency: 'USD' },
      ],
    });
  const a = await spend(bank, groceries, 2000, '2026-10-02', `Corner ${tag}`, `weekly ${tag}`);
  const b = await spend(cash, dining, 1500, '2026-10-10', `Pizza ${tag}`);
  const c = await spend(bank, groceries, 3000, '2026-10-20', `Corner ${tag}`);
  return {
    bank,
    cash,
    groceries,
    dining,
    ids: [a, b, c],
    tag,
    names: {
      bank: `Bank ${tag}`,
      cash: `Cash ${tag}`,
      groceries: `Groceries ${tag}`,
      dining: `Dining ${tag}`,
    },
  };
}

test('filters by account, category and text, in the address, and a reload is the same view', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `filter ${browserName}`);
  await page.goto('/transactions');
  const rows = page.getByRole('table').getByRole('row');
  const tag = f.tag;

  await page
    .getByRole('form', { name: 'Filters' })
    .getByLabel('Account', { exact: true })
    .selectOption({ label: f.names.cash });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(new RegExp(`account=${f.cash}`));
  await expect(page.getByRole('table')).toContainText(`Pizza ${tag}`);
  await expect(page.getByRole('table')).not.toContainText(`Corner ${tag}`);

  await page
    .getByRole('form', { name: 'Filters' })
    .getByLabel('Account', { exact: true })
    .selectOption({ label: f.names.bank });
  await page
    .getByRole('form', { name: 'Filters' })
    .getByLabel('Payee or note', { exact: true })
    .fill(`WEEKLY ${tag}`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('table')).toContainText(`Corner ${tag}`);
  await expect(page.getByRole('table')).not.toContainText('2026-10-20');
  const address = page.url();
  await page.reload();
  expect(page.url()).toBe(address);
  await expect(
    page.getByRole('form', { name: 'Filters' }).getByLabel('Payee or note', { exact: true }),
  ).toHaveValue(`WEEKLY ${tag}`);
  await expect(page.getByRole('table')).toContainText('2026-10-02');
  expect(await rows.count()).toBe(2);

  // A category, and a % that is only a %.
  await page.goto('/transactions');
  await page
    .getByRole('form', { name: 'Filters' })
    .getByLabel('Category', { exact: true })
    .selectOption({ label: f.names.dining });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(new RegExp(`subcategory=${f.dining}`));
  await expect(page.getByRole('table')).toContainText(`Pizza ${tag}`);
  await page.goto('/transactions?q=%25');
  await expect(page.getByText('No entries match.')).toBeVisible();
});

test('shows the one account’s balance after each entry', async ({ page, browserName }) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `balance ${browserName}`);
  await page.goto(`/transactions?account=${f.bank}`);
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader', { name: 'Balance' })).toBeVisible();
  await expect(table.getByRole('row', { name: /2026-10-20/ })).toContainText('$950.00');
  await expect(table.getByRole('row', { name: /2026-10-02/ })).toContainText('$980.00');
  await expect(table.getByRole('row', { name: /Opening balance/ })).toContainText('$1,000.00');
});

test('marks several cleared, moves them to another subcategory, and deletes them', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `bulk ${browserName}`);
  await page.goto(`/transactions?q=${encodeURIComponent(f.tag)}`);
  const table = page.getByRole('table');
  await table.getByRole('checkbox', { name: /Choose the entry of 2026-10-02/ }).check();
  await table.getByRole('checkbox', { name: /Choose the entry of 2026-10-20/ }).check();
  const bar = page.getByRole('group', { name: 'What to do with the chosen entries' });
  await expect(bar).toContainText('2 chosen');
  await bar.getByRole('button', { name: 'Mark cleared' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'changed' })).toContainText(
    '2 entries changed',
  );
  await expect(table.getByRole('row', { name: /2026-10-02/ })).toContainText('Cleared');
  await expect(table.getByRole('row', { name: /2026-10-10/ })).toContainText('Pending');

  await table.getByRole('checkbox', { name: /Choose the entry of 2026-10-02/ }).check();
  await bar
    .getByLabel('Move to a subcategory')
    .selectOption({ label: `${f.names.dining} · Food ${f.tag}` });
  await bar.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(table.getByRole('row', { name: /2026-10-02/ })).toContainText(`Dining ${f.tag}`);

  await table.getByRole('checkbox', { name: /Choose the entry of 2026-10-20/ }).check();
  await bar.getByRole('button', { name: 'Delete…' }).click();
  await bar.getByRole('button', { name: 'Delete for good' }).click();
  await expect(table).not.toContainText('2026-10-20');
  await expect(table).toContainText('2026-10-02');
});
