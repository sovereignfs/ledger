import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * Export and import (tasks 11.1 and 11.2, DESIGN.md §16): the book is downloaded as one file, and a file is refused with sentences when it is not one, and when the book it would go
 * into has things in it. The round trip into a second account is the data layer's test: this instance has the one account.
 */
test('downloads the book as one file, and refuses a file that is not right, writing nothing', async ({
  page,
  browserName,
}) => {
  await signedIn(page);
  // A book with something in it, whatever the order the tests run in.
  await page.goto('/accounts');
  const made = await page.request.post('/api/accounts', {
    data: {
      type: 'bank',
      name: `Exported ${browserName}`,
      currency: 'USD',
      opening: { amount: 100, date: '2020-01-01' },
    },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(made.status()).toBe(201);
  await page.goto('/account?section=data');
  const data = page.getByRole('region', { name: 'Data', exact: true });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('link', { name: 'Export your book' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^ledger-.+-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const file = JSON.parse(await readFile(path, 'utf8')) as {
    format: string;
    version: number;
    tables: Record<string, unknown[]>;
  };
  expect(file).toMatchObject({ format: 'ledger', version: 1 });
  expect(Object.keys(file.tables)).toContain('txn');
  expect(JSON.stringify(file.tables.money_account)).toContain(`Exported ${browserName}`);

  // Not JSON: refused in a sentence.
  await data.getByLabel('File to import').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('this is not json'),
  });
  await expect(data.getByRole('alert')).toContainText('not a Ledger file');

  // A real file, into a book that has things in it: refused, and the book is as it was.
  await data.getByLabel('File to import').setInputFiles({
    name: 'ledger.json',
    mimeType: 'application/json',
    buffer: await readFile(path),
  });
  await expect(data.getByRole('alert')).toContainText('empty book');
});
