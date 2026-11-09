import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Saving jars (tasks 7.1 to 7.3, DESIGN.md §10): a jar is an earmark inside a savings account. It is made on the account's page, money is earmarked in it and
 * released, nothing goes past what the account holds, and the Saving group of the budget shows it with its monthly contribution.
 */
async function savings(page: Page, tag: string, opening = 100_000) {
  const origin = new URL(page.url()).origin;
  const reply = await page.request.post('/api/accounts', {
    data: {
      type: 'savings',
      name: `Savings ${tag}`,
      currency: 'USD',
      opening: { amount: opening, date: '2020-01-01' },
    },
    headers: { origin },
  });
  expect(reply.status()).toBe(201);
  return ((await reply.json()) as { id: string }).id;
}

test('makes a jar, earmarks and releases, and refuses more than is free', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `jars ${browserName}`;
  const account = await savings(page, tag);
  await page.goto(`/accounts/${account}`);

  const jars = page.getByRole('region', { name: 'Jars', exact: true });
  await jars.getByLabel('Jar name').fill(`Travel ${tag}`);
  await jars.getByLabel('Target').fill('3000');
  await jars.getByRole('button', { name: 'Add jar' }).click();
  const jar = jars.getByRole('listitem').filter({ hasText: `Travel ${tag}` });
  await expect(jar).toContainText('$0.00 of $3,000.00');

  await jar.getByLabel(`Amount for Travel ${tag}`).fill('400');
  await jar.getByRole('button', { name: `Earmark in Travel ${tag}` }).click();
  await expect(jar).toContainText('$400.00 of $3,000.00');
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toContainText('In jars');
  await expect(summary).toContainText('$400.00');
  await expect(summary).toContainText('$600.00');

  // More than is free is refused, in a sentence, and nothing changes.
  await jar.getByLabel(`Amount for Travel ${tag}`).fill('700');
  await jar.getByRole('button', { name: `Earmark in Travel ${tag}` }).click();
  await expect(jars.getByRole('alert')).toContainText('not that much free');
  await expect(jar).toContainText('$400.00 of $3,000.00');

  await jar.getByLabel(`Amount for Travel ${tag}`).fill('150');
  await jar.getByRole('button', { name: `Release from Travel ${tag}` }).click();
  await expect(jar).toContainText('$250.00 of $3,000.00');
});

test('shows a jar with its monthly contribution in the Saving group of the budget', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  await page.goto('/accounts');
  const tag = `saving ${browserName}`;
  const account = await savings(page, tag);
  await page.goto(`/accounts/${account}`);
  const jars = page.getByRole('region', { name: 'Jars', exact: true });
  await jars.getByLabel('Jar name').fill(`Car ${tag}`);
  await jars.getByRole('button', { name: 'Add jar' }).click();
  const jar = jars.getByRole('listitem').filter({ hasText: `Car ${tag}` });
  await jar.getByText('Monthly contribution').click();
  await jar.getByLabel(`Monthly contribution for Car ${tag}`).fill('150');
  await jar.getByRole('button', { name: 'Set contribution' }).click();
  await expect(jar.getByRole('status')).toContainText('Set from this month');
  await expect(jar).toContainText('$150.00 a month');

  await page.goto('/budget');
  const row = page
    .getByRole('region', { name: 'Saving' })
    .getByRole('link', { name: new RegExp(`Car ${tag}`) });
  await expect(row).toContainText('$150.00 a month');
});
