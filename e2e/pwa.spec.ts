import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * The installable app (task 1.11, DESIGN.md §14.6): a manifest and icons a browser installs from, and a service worker that keeps **the build's files, the icons and the
 * manifest only**, never a page with money on it, and says Ledger needs a connection when there is none.
 */
test('serves a manifest with icons that are images, and a worker that is never cached by the browser', async ({
  request,
}) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const body = (await manifest.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string }[];
  };
  expect(body).toMatchObject({ name: 'Ledger', display: 'standalone', start_url: '/' });
  expect(body.icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of body.icons) {
    const reply = await request.get(icon.src);
    expect(reply.status(), icon.src).toBe(200);
    expect(reply.headers()['content-type']).toBe('image/png');
  }
  const worker = await request.get('/sw.js');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['content-type']).toContain('javascript');
  expect(worker.headers()['cache-control']).toContain('no-cache');
  expect(worker.headers()['service-worker-allowed']).toBe('/');
  expect(await worker.text()).toContain('ledger-shell-');
});

test('installs in Chromium, keeps only the build’s files, and says it needs a connection offline', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'installing is Chromium’s, and the worker is tested here in the browser that installs it',
  );
  await signedIn(page);
  await page.goto('/accounts');
  // The worker is registered once the page has loaded, and has installed.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await caches.keys()).filter((name) => name.startsWith('ledger-shell-')).length,
      ),
    )
    .toBe(1);

  // Nothing the browser would refuse to install for.
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.map((each) => each.errorId)).toEqual([]);

  // Pages with money on them, visited under the worker, so as to see what it keeps.
  await page.reload();
  for (const path of ['/accounts', '/budget', '/transactions', '/reports', '/']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  const kept = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) out.push(new URL(request.url).pathname);
    }
    return out;
  });
  expect(kept.length).toBeGreaterThan(0);
  for (const path of kept)
    expect(path, 'kept').toMatch(
      /^\/(_next\/static\/|icons\/[a-z0-9._-]+$|manifest\.webmanifest$|icon\.svg$|favicon\.ico$)/,
    );

  // Offline: a page of Ledger is not here, and the worker says so in a page of its own, with nothing of the person's.
  await context.setOffline(true);
  await page.goto('/accounts');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ledger needs a connection' }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Bank');
  await context.setOffline(false);
});
