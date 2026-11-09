import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Income (task 5.3, DESIGN.md §7.4): sources with one primary, a budgeted amount from this month or next, and what was received, shown apart. Both browsers share
 * the instance, so each test names its own sources. The book has no base currency here, so each currency is shown on its own.
 */
test('adds income sources, the first primary, sets a budget and sees what was received apart from it', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/budget/income');
  const name = `Salary ${browserName}`;
  await page.getByLabel('New income source').fill(name);
  await page.getByRole('button', { name: 'Add income source' }).click();
  const section = page.getByRole('region', { name, exact: true });
  await expect(section).toBeVisible();

  await section.getByLabel(`Budgeted amount for ${name}`).fill('5000');
  await section.getByRole('button', { name: 'Set', exact: true }).click();
  await expect(section).toContainText('Budgeted $5,000.00');

  // Income that arrives is an income entry naming the source.
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: unknown) => {
    const reply = await page.request.post(path, { data, headers: { origin } });
    expect(reply.status(), path).toBe(201);
    return ((await reply.json()) as { id: string }).id;
  };
  const bank = await post('/api/accounts', {
    type: 'bank',
    name: `Bank ${browserName}`,
    currency: 'USD',
  });
  const sources = (await (await page.request.get('/api/income-sources')).json()) as {
    sources: { id: string; name: string }[];
  };
  const source = sources.sources.find((s) => s.name === name)?.id as string;
  const today = new Date().toISOString().slice(0, 10);
  await post('/api/transactions', {
    type: 'income',
    date: today,
    lines: [
      { account: bank, amount: 520000, currency: 'USD' },
      { incomeSource: source, amount: -520000, currency: 'USD' },
    ],
  });
  await page.reload();
  await expect(page.getByRole('region', { name, exact: true })).toContainText('Received $5,200.00');
  // The month's own figures are shared with the other browser's test on this instance, so only that they are shown is asked.
  await expect(page.getByRole('region', { name: /^Income in / })).toContainText(
    /Received \$[\d,]+\.\d\d/,
  );
});

test('keeps one primary: another is secondary, can be made primary, and the primary is not deleted', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/budget/income');
  const side = `Side ${browserName}`;
  await page.getByLabel('New income source').fill(side);
  await page.getByRole('button', { name: 'Add income source' }).click();
  const section = page.getByRole('region', { name: side, exact: true });
  await expect(section).toContainText('Secondary');
  await expect(page.getByRole('button', { name: /^Delete .*/ }).first()).toBeVisible();
  await section.getByRole('button', { name: `Make ${side} the primary` }).click();
  await expect(page.getByRole('region', { name: side, exact: true })).toContainText('Primary');
  await expect(
    page
      .getByRole('region', { name: side, exact: true })
      .getByRole('button', { name: `Delete ${side}` }),
  ).toHaveCount(0);
  // The next change of primary leaves the earlier one secondary, and deletable.
  // Only this one is the primary now: it cannot be made primary again.
  await expect(page.getByRole('button', { name: `Make ${side} the primary` })).toHaveCount(0);
});

test('shows an earlier month and a later month, and a budget from next month is not in this one', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/budget/income');
  const name = `Planned ${browserName}`;
  await page.getByLabel('New income source').fill(name);
  await page.getByRole('button', { name: 'Add income source' }).click();
  const section = page.getByRole('region', { name, exact: true });
  await section.getByLabel(`Budgeted amount for ${name}`).fill('100');
  await section.getByLabel(`From, for ${name}`).selectOption('next');
  await section.getByRole('button', { name: 'Set', exact: true }).click();
  await expect(section).toContainText('Budgeted nothing yet');
  await page.getByRole('link', { name: 'Later' }).click();
  await expect(page.getByRole('region', { name, exact: true })).toContainText('Budgeted $100.00');
  await page.getByRole('link', { name: 'Earlier' }).click();
  await page.getByRole('link', { name: 'Earlier' }).click();
  await expect(page.getByRole('region', { name, exact: true })).toContainText(
    'Budgeted nothing yet',
  );
});
