import { expect, test } from '@playwright/test';
import { ROUTES } from '../src/access/routes';
import { signedIn } from './helpers';

/**
 * What is a person's is never kept by a cache (DESIGN.md §14.6, §19): **every page and every route for a signed-in person that has no parameter is answered `no-store`**, a shared
 * cache between the server and the browser included. The addresses come from the table of who may call what (`src/access/routes.ts`), so a new one is held to it without being
 * added here.
 */
test('every page and route of a book is answered with no-store', async ({ page }) => {
  await signedIn(page);
  const addresses: string[] = [];
  for (const rule of ROUTES) {
    if (rule.route.includes('[')) continue;
    if (rule.page?.kind === 'book') addresses.push(rule.route);
    if (rule.methods?.GET?.kind === 'book') addresses.push(rule.route);
  }
  expect(addresses.length).toBeGreaterThan(10);

  const lacking: string[] = [];
  for (const address of addresses) {
    const reply = await page.request.get(address, { maxRedirects: 0 });
    const control = reply.headers()['cache-control'] ?? '';
    // What carries something of a person is a success; a redirect, a refusal and a 404 carry nothing.
    if (reply.ok() && !/no-store/.test(control))
      lacking.push(`${address} ${reply.status()} ${control || '(no cache-control)'}`);
  }
  expect(lacking).toEqual([]);
});
