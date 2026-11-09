import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Recurring entries (task 6.2, DESIGN.md §8.2): "Repeat…" in an entry's dialog makes it repeat, and the Bills page shows it, switches whether it posts
 * itself or asks first, and ends it. The server's job posting what is due is the data layer's tests; here is what a person does.
 */
async function entry(page: Page, tag: string, date: string): Promise<string> {
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
  const category = await post('/api/categories', { name: `Home ${tag}`, currency: 'USD' });
  const subcategory = await post(`/api/categories/${category}/subcategories`, {
    name: `Rent ${tag}`,
  });
  await post('/api/transactions', {
    type: 'expense',
    date,
    payee: `Landlord ${tag}`,
    lines: [
      { account, amount: -90_000, currency: 'USD' },
      { subcategory, amount: 90_000, currency: 'USD' },
    ],
  });
  return account;
}

test('makes an entry repeat from its dialog, then switches it to asking first, and ends it', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `repeat ${browserName}`;
  const date = '2020-03-16';
  const account = await entry(page, tag, date);

  await page.goto(`/accounts/${account}`);
  await page
    .getByRole('button', { name: `Edit the entry of ${date}` })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Edit entry' });
  await dialog.getByRole('button', { name: 'Repeat…' }).click();
  await dialog.getByLabel('Unit').selectOption('week');
  await dialog.getByLabel(/^Every/).fill('2');
  await dialog.getByRole('button', { name: 'Repeat this entry' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/budget/bills');
  const row = page.getByRole('listitem').filter({ hasText: `Landlord ${tag}` });
  await expect(row).toContainText('$900.00');
  await expect(row).toContainText('Every 2 weeks');
  await expect(row).toContainText('Posts itself');

  await row.getByRole('button', { name: `Ask first: Landlord ${tag}` }).click();
  await expect(row).toContainText('Asks first');

  await row.getByRole('button', { name: `End Landlord ${tag}` }).click();
  await row.getByRole('button', { name: 'End for good' }).click();
  await expect(row).toContainText('Ended');
  await expect(row.getByRole('button', { name: 'Ask first' })).toHaveCount(0);
});

test('says why an entry that repeats already cannot be made to repeat again', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `again ${browserName}`;
  const date = '2020-04-16';
  const account = await entry(page, tag, date);
  await page.goto(`/accounts/${account}`);
  const repeat = async () => {
    await page
      .getByRole('button', { name: `Edit the entry of ${date}` })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Edit entry' });
    await dialog.getByRole('button', { name: 'Repeat…' }).click();
    await dialog.getByRole('button', { name: 'Repeat this entry' }).click();
    return dialog;
  };
  await expect(await repeat()).toBeHidden();
  await page.reload();
  const again = await repeat();
  await expect(again.getByRole('alert')).toBeVisible();
});

/** A bill that asks first, due long ago (so it is overdue whatever the clock) and with one occurrence only, made through the app's own routes. */
async function bill(page: Page, tag: string, date: string) {
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
    opening: { amount: 100_000, date: '2020-01-01' },
  });
  const category = await post('/api/categories', { name: `Bills ${tag}`, currency: 'USD' });
  const subcategory = await post(`/api/categories/${category}/subcategories`, {
    name: `Power ${tag}`,
  });
  await post('/api/recurring', {
    template: {
      type: 'expense',
      payee: `Electric ${tag}`,
      lines: [
        { account, amount: -9_000, currency: 'USD' },
        { subcategory, amount: 9_000, currency: 'USD' },
      ],
    },
    unit: 'month',
    every: 1,
    anchor: date,
    end: date,
    mode: 'confirm',
  });
  return account;
}

test('posts a bill that asks first with the amount it came to, once, and it is gone from Upcoming', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `confirm ${browserName}`;
  const account = await bill(page, tag, '2020-06-10');

  await page.goto('/');
  const upcoming = page.getByRole('region', { name: 'Upcoming' });
  const row = upcoming.getByRole('listitem').filter({ hasText: `Electric ${tag}` });
  await expect(row).toContainText('Overdue');
  await expect(row).toContainText('2020-06-10');
  await expect(row).toContainText('$90.00');

  await page.goto('/transactions');
  const there = page
    .getByRole('region', { name: 'Upcoming' })
    .getByRole('listitem')
    .filter({ hasText: `Electric ${tag}` });
  await there.getByLabel(`Amount for Electric ${tag}`).fill('112.50');
  await there.getByRole('button', { name: `Post Electric ${tag}` }).click();
  await expect(there).toHaveCount(0);

  await page.goto(`/accounts/${account}`);
  await expect(page.getByRole('button', { name: 'Edit the entry of 2020-06-10' })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$887.50');
});

test('skips a bill that asks first: it is gone and nothing is posted', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `skip ${browserName}`;
  const account = await bill(page, tag, '2020-07-10');
  await page.goto('/transactions');
  const row = page
    .getByRole('region', { name: 'Upcoming' })
    .getByRole('listitem')
    .filter({ hasText: `Electric ${tag}` });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Skip Electric ${tag}` }).click();
  await expect(row).toHaveCount(0);
  await page.goto(`/accounts/${account}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$1,000.00');
  await expect(page.getByRole('button', { name: 'Edit the entry of 2020-07-10' })).toHaveCount(0);
});

test('budgets a subcategory by its bills: a yearly 600 is 50 a month, and it follows an edit of the bill', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `insure ${browserName}`;
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
  const category = await post('/api/categories', { name: `Cover ${tag}`, currency: 'USD' });
  const subcategory = await post(`/api/categories/${category}/subcategories`, {
    name: `Car ${tag}`,
  });

  await page.goto('/budget/categories');
  await page.getByRole('button', { name: `Budget Car ${tag} by its bills` }).click();
  await expect(page.getByRole('button', { name: `Budget Car ${tag} by hand` })).toBeVisible();

  const template = (amount: number) => ({
    type: 'expense',
    payee: `Insurer ${tag}`,
    lines: [
      { account, amount: -amount, currency: 'USD' },
      { subcategory, amount, currency: 'USD' },
    ],
  });
  const bill = await post('/api/recurring', {
    template: template(60_000),
    unit: 'year',
    every: 1,
    anchor: '2099-07-01',
    mode: 'auto',
  });

  await page.goto('/budget');
  const row = page
    .getByRole('region', { name: 'Bills', exact: true })
    .getByRole('link', { name: new RegExp(`Car ${tag}`) });
  await expect(row).toContainText('of $50.00');

  // Edited: from this month it is 60 a month. The hand editor is not offered for it.
  const changed = await page.request.patch(`/api/recurring/${bill}`, {
    data: { template: template(72_000) },
    headers: { origin },
  });
  expect(changed.status()).toBe(200);
  await page.goto('/budget');
  await expect(row).toContainText('of $60.00');
  await row.click();
  await expect(page.getByText('This is budgeted by its recurring bills')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Set budget|^Save/ })).toHaveCount(0);
});

test('pays a loan’s instalments: offered on the loan, each split into interest and principal when posted', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `loan ${browserName}`;
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const reply = await page.request.post(path, { data, headers: { origin } });
    expect(reply.status(), path).toBe(201);
    return ((await reply.json()) as { id: string }).id;
  };
  await post('/api/accounts', { type: 'bank', name: `Pays ${tag}`, currency: 'USD' });
  const loan = await post('/api/accounts', {
    type: 'loan',
    name: `Car ${tag}`,
    currency: 'USD',
    opening: { amount: -1_000_000, date: '2020-01-01' },
    loan: {
      lender: `Lender ${tag}`,
      principal: 1_000_000,
      startDate: '2020-01-01',
      endDate: '2031-01-01',
      instalment: 20_000,
      yearlyRate: '6',
      interestSubcategoryId: null,
    },
  });

  await page.goto(`/accounts/${loan}`);
  const form = page.getByRole('form', { name: 'Pay the instalments' });
  await form.getByLabel('Pay from').selectOption({ label: `Pays ${tag}` });
  await form.getByLabel('First instalment').fill('2020-02-01');
  await form.getByLabel('Ask me before each is posted').check();
  await form.getByRole('button', { name: 'Pay the instalments' }).click();
  await expect(page.getByRole('region', { name: 'Instalments' })).toContainText('asking you first');

  // The first is waiting, and is posted: 31 days of 6% on 10,000.00 is 50.96, so 149.04 comes off the loan.
  await page.goto('/transactions');
  const row = page
    .getByRole('region', { name: 'Upcoming' })
    .getByRole('listitem')
    .filter({ hasText: `Lender ${tag}` });
  await expect(row).toContainText('$200.00');
  await row.getByRole('button', { name: `Post Lender ${tag}` }).click();
  await page.goto(`/accounts/${loan}`);
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$9,850.96');

  // Leave nothing waiting for the other tests.
  const all = (await (await page.request.get('/api/recurring')).json()) as {
    recurring: { id: string; loanAccountId: string | null }[];
  };
  const mine = all.recurring.find((each) => each.loanAccountId === loan);
  expect(mine).toBeDefined();
  const ended = await page.request.delete(`/api/recurring/${mine?.id}`, { headers: { origin } });
  expect(ended.status()).toBe(200);
});
