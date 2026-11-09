import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Status and reconciling (task 4.8, DESIGN.md §6.4, §6.7): an entry's status turned over by hand, and an account reconciled to a statement 1.20 above, which
 * clears the entries to the date and records the difference as an adjustment, once. Fixtures are made through the app's own routes with its own `Origin`.
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
    opening: { amount: 10000, date: '2026-10-01' },
  });
  const category = await post('/api/categories', { name: `Food ${tag}`, currency: 'USD' });
  const sub = await post(`/api/categories/${category}/subcategories`, { name: `Groceries ${tag}` });
  const spend = (amount: number, date: string) =>
    post('/api/transactions', {
      type: 'expense',
      date,
      lines: [
        { account: bank, amount: -amount, currency: 'USD' },
        { subcategory: sub, amount, currency: 'USD' },
      ],
    });
  await spend(2000, '2026-10-10');
  await spend(500, '2026-10-25');
  return { bank };
}

test('turns an entry’s status over by hand', async ({ page, browserName }) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `status ${browserName}`);
  await page.goto(`/accounts/${f.bank}`);
  const entries = page.getByRole('region', { name: 'Entries' });
  const row = entries.getByRole('row', { name: /2026-10-10/ });
  await expect(row.getByRole('button', { name: /mark cleared/ })).toHaveText('Pending');
  await row.getByRole('button', { name: /mark cleared/ }).click();
  await expect(
    entries.getByRole('row', { name: /2026-10-10/ }).getByRole('button', { name: /mark pending/ }),
  ).toHaveText('Cleared');
  await entries
    .getByRole('row', { name: /2026-10-10/ })
    .getByRole('button', { name: /mark pending/ })
    .click();
  await expect(
    entries.getByRole('row', { name: /2026-10-10/ }).getByRole('button', { name: /mark cleared/ }),
  ).toHaveText('Pending');
});

test('reconciles to a statement 1.20 above: the difference is shown, an adjustment is recorded once, and entries to the date are cleared', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const f = await fixtures(page, `reconcile ${browserName}`);
  await page.goto(`/accounts/${f.bank}`);
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reconcile' });
  await dialog.getByLabel('Statement date').fill('2026-10-15');
  await dialog.getByLabel('Balance on the statement').fill('81.20');
  await expect(dialog).toContainText('come to $80.00');
  await expect(dialog).toContainText('1 of them is pending: they will be marked cleared');
  await expect(dialog).toContainText('An adjustment of $1.20 will be recorded.');
  await dialog.getByRole('button', { name: 'Reconcile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reconciled' })).toContainText(
    '1 cleared, and an adjustment of $1.20 recorded.',
  );

  const entries = page.getByRole('region', { name: 'Entries' });
  await expect(
    entries.getByRole('row', { name: /2026-10-10/ }).getByRole('button', { name: /mark pending/ }),
  ).toHaveText('Cleared');
  await expect(
    entries.getByRole('row', { name: /2026-10-25/ }).getByRole('button', { name: /mark cleared/ }),
  ).toHaveText('Pending');
  await expect(entries.getByRole('row', { name: /Adjustment/ })).toContainText('$1.20');
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('$76.20');

  // Again, to the same figure: nothing to record.
  await page.getByRole('button', { name: 'Reconcile', exact: true }).first().click();
  const again = page.getByRole('dialog', { name: 'Reconcile' });
  await again.getByLabel('Statement date').fill('2026-10-15');
  await again.getByLabel('Balance on the statement').fill('81.20');
  await expect(again).toContainText('That matches the statement: nothing will be adjusted.');
  await again.getByRole('button', { name: 'Reconcile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reconciled' })).toContainText(
    'nothing to adjust',
  );
  await expect(entries.getByRole('row', { name: /Adjustment/ })).toHaveCount(1);
});
