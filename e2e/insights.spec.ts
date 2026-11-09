import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Insights (task 8.7, DESIGN.md §12): an expense of more than three times the usual for its subcategory, with five others to compare, is worth a look on Overview, with a link. Fixtures are
 * made through the app's own routes; the days are counted back from today, so that the six months and the last thirty days hold.
 */
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

test('says an unusually large expense on Overview, with a link to the subcategory’s entries', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `large ${browserName}`;
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
    opening: { amount: 5_000_000, date: daysAgo(400) },
  });
  const category = await post('/api/categories', { name: `Fun ${tag}`, currency: 'USD' });
  const sub = await post(`/api/categories/${category}/subcategories`, { name: `Outings ${tag}` });
  const spend = (date: string, amount: number) =>
    post('/api/transactions', {
      type: 'expense',
      date,
      lines: [
        { account, amount: -amount, currency: 'USD' },
        { subcategory: sub, amount, currency: 'USD' },
      ],
    });
  for (const days of [160, 130, 100, 70, 40]) await spend(daysAgo(days), 1_000);

  // Five to compare with, and nothing out of the ordinary yet.
  await spend(daysAgo(2), 1_500);
  await page.goto('/');
  await expect(page.getByRole('link', { name: new RegExp(`Outings ${tag}`) })).toHaveCount(0);

  await spend(daysAgo(1), 3_500);
  await page.goto('/');
  const look = page.getByRole('region', { name: 'Worth a look' });
  const link = look.getByRole('link', {
    name: new RegExp(`Outings ${tag} on .* is more than three times the usual \\$10\\.00`),
  });
  await expect(link).toBeVisible();
  await expect(link).toContainText('$35.00');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?subcategory=${sub}`));
});
