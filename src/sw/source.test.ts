import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX, inertWorkerSource, workerSource } from './source';

/**
 * The service worker (DESIGN.md §14.6): **what it keeps is an allow-list, and nothing else gets in.** This evaluates the very text that is served, with a cache and a
 * network that the test controls, and looks at what is in the cache after everything a signed-in person does: no page with money on it, no answer from an API, nothing
 * that is not a built file, an icon or the manifest. With no network, a page is answered with one the worker builds itself.
 */
const ORIGIN = 'https://ledger.test';
const FILES = [
  '/_next/static/chunks/a.js',
  '/_next/static/chunks/b.css',
  '/_next/static/media/font.woff2',
];

type Listener = (event: Record<string, unknown>) => void;

function load(version = 'v1', files: readonly string[] = FILES) {
  const stores = new Map<string, Map<string, Response>>();
  const requested: string[] = [];
  const state = { online: true };
  const network = async (input: Request | string): Promise<Response> => {
    const request = typeof input === 'string' ? new Request(`${ORIGIN}${input}`) : input;
    const path = new URL(request.url).pathname;
    requested.push(path);
    if (!state.online) throw new TypeError('no network');
    if (path.startsWith('/_next/static/'))
      return new Response('file', { headers: { 'content-type': 'text/javascript' } });
    if (/^\/(icons\/|manifest\.webmanifest|icon\.svg|favicon\.ico)/.test(path))
      return new Response('an icon', { headers: { 'content-type': 'image/png' } });
    if (path.startsWith('/api/'))
      return new Response('{"balance":123456,"payee":"Ada Lovelace"}', {
        headers: { 'content-type': 'application/json' },
      });
    return new Response(`<html>Savings $1,234.56 for ada@example.com at ${path}</html>`, {
      headers: { 'content-type': 'text/html' },
    });
  };
  const cacheOf = (name: string) => {
    let store = stores.get(name);
    if (!store) stores.set(name, (store = new Map()));
    const kept = store;
    const keyOf = (r: Request | string) =>
      (typeof r === 'string' ? new Request(`${ORIGIN}${r}`) : r).url;
    return {
      match: async (r: Request | string) => kept.get(keyOf(r))?.clone(),
      put: async (r: Request | string, response: Response) => void kept.set(keyOf(r), response),
      add: async (r: Request | string) => {
        const request = typeof r === 'string' ? new Request(`${ORIGIN}${r}`) : r;
        const response = await network(request);
        if (!response.ok) throw new TypeError('not ok');
        kept.set(keyOf(request), response);
      },
    };
  };
  const listeners = new Map<string, Listener>();
  const scope = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
    caches: {
      open: async (name: string) => cacheOf(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
    registration: { unregister: async () => true },
    skipWaiting: () => undefined,
  };
  const context = vm.createContext({
    self: scope,
    caches: scope.caches,
    fetch: network,
    Request,
    Response,
    URL,
    console,
  });
  vm.runInContext(workerSource(version, files), context);

  const wait = async (event: { waits: Promise<unknown>[] }) =>
    void (await Promise.all(event.waits));
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    listeners.get(type)?.({
      ...extra,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<Response>) => (answer = p),
    });
    await wait({ waits });
    return answer ? await answer : undefined;
  };
  /** A request of a kind (a page is a `navigate`), which a real one fixes and a test cannot set: so it is made one that says its kind. */
  const requestOf = (url: string, mode: string, init?: RequestInit) =>
    new (class extends Request {
      override get mode(): RequestMode {
        return mode as RequestMode;
      }
    })(url, init);
  const get = (path: string, mode: 'navigate' | 'no-cors' = 'no-cors') =>
    fire('fetch', { request: requestOf(`${ORIGIN}${path}`, mode) });
  const kept = () =>
    [...stores.entries()].flatMap(([name, store]) =>
      [...store.keys()].map((url) => `${name} ${new URL(url).pathname}`),
    );
  return { state, requested, fire, get, kept, stores, listeners, requestOf };
}

describe('the service worker keeps an allow-list, and nothing else', () => {
  it('keeps the build’s files when it installs, and nothing else', async () => {
    const w = load();
    await w.fire('install');
    expect(w.kept().sort()).toEqual(FILES.map((file) => `${CACHE_PREFIX}v1 ${file}`).sort());
  });

  it('keeps no page with money on it and no answer from the server, whatever a person does', async () => {
    const w = load();
    await w.fire('install');
    for (const path of [
      '/',
      '/accounts',
      '/accounts/abc',
      '/budget',
      '/transactions',
      '/reports?month=2026-10',
      '/account',
    ])
      await w.get(path, 'navigate');
    for (const path of [
      '/api/accounts',
      '/api/transactions',
      '/api/export',
      '/api/budget?month=2026-10',
      '/api/recurring',
    ])
      await w.get(path);
    const kept = w.kept().join('\n');
    expect(kept).not.toMatch(/accounts|budget|transactions|reports|api|export|recurring/);
    expect(kept.split('\n')).toHaveLength(FILES.length);
  });

  it('answers a page from the network every time, leaves an API request and a POST alone', async () => {
    const w = load();
    await w.fire('install');
    w.requested.length = 0;
    const page = await w.get('/accounts', 'navigate');
    expect(await page?.text()).toContain('$1,234.56');
    // The page is the worker's to ask for (and never to keep); the API is not its at all: it does not answer, so the browser asks the network as it would without a worker.
    expect(await w.get('/api/accounts')).toBeUndefined();
    expect(w.requested).toEqual(['/accounts']);
    const post = await w.fire('fetch', {
      request: w.requestOf(`${ORIGIN}/api/transactions`, 'cors', { method: 'POST', body: '{}' }),
    });
    expect(post).toBeUndefined();
  });

  it('keeps an icon, the manifest and a built file it did not know of when they are asked for, and serves them from the cache', async () => {
    const w = load();
    await w.get('/icons/icon-192.png');
    await w.get('/manifest.webmanifest');
    await w.get('/_next/static/chunks/c.js');
    expect(
      w
        .kept()
        .map((entry) => entry.split(' ')[1])
        .sort(),
    ).toEqual(['/_next/static/chunks/c.js', '/icons/icon-192.png', '/manifest.webmanifest']);
    w.requested.length = 0;
    await w.get('/icons/icon-192.png');
    expect(w.requested).toEqual([]);
  });

  it('does not keep what is not an icon, though it is under the icons’ address: a path with a slash, a query a page might add', async () => {
    const w = load();
    await w.get('/icons/a/b.png');
    await w.get('/icons/../api/accounts');
    expect(w.kept().filter((entry) => entry.includes('api') || entry.includes('/a/'))).toEqual([]);
  });
});

describe('with no network', () => {
  it('answers a page with one of its own that says Ledger needs a connection, holding nothing of a person and no script', async () => {
    const w = load();
    await w.fire('install');
    await w.get('/accounts', 'navigate');
    w.state.online = false;
    const page = await w.get('/accounts', 'navigate');
    const body = (await page?.text()) ?? '';
    expect(page?.status).toBe(200);
    expect(body).toContain('Ledger needs a connection');
    expect(body).not.toContain('$1,234.56');
    expect(body).not.toContain('ada@example.com');
    expect(body).not.toContain('<script');
    expect(page?.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(page?.headers.get('cache-control')).toBe('no-store');
    // And the same for the front address, where Overview is: it is not kept either.
    expect(await (await w.get('/', 'navigate'))?.text()).toContain('needs a connection');
  });

  it('serves a kept built file with no network, and lets an API request fail as it would', async () => {
    const w = load();
    await w.fire('install');
    w.state.online = false;
    expect(await (await w.get('/_next/static/chunks/a.js'))?.text()).toBe('file');
    await expect(w.get('/api/accounts')).resolves.toBeUndefined();
  });
});

describe('a new version', () => {
  it('removes the caches of the old ones, and no others, and does not take over a page that is open', async () => {
    const w = load('v2');
    w.stores.set(`${CACHE_PREFIX}v1`, new Map());
    w.stores.set('another-app-cache', new Map());
    await w.fire('activate');
    expect([...w.stores.keys()].sort()).toEqual(['another-app-cache']);
    expect(workerSource('v2', FILES)).not.toContain('skipWaiting');
    expect(workerSource('v2', FILES)).not.toContain('clients.claim');
  });

  it('is a worker of its own build: the version is in the name of its cache', async () => {
    const w = load('abc123');
    await w.fire('install');
    expect(w.kept()[0]).toContain(`${CACHE_PREFIX}abc123`);
  });
});

describe('the worker of a server that is not a build', () => {
  it('keeps nothing, takes over at once and removes itself and the caches of any build', async () => {
    const source = inertWorkerSource();
    expect(source).not.toContain('cache.add');
    expect(source).not.toContain('cache.put');
    expect(source).toContain('unregister');
    expect(source).toContain('skipWaiting');
    expect(source).not.toContain("addEventListener('fetch'");
  });
});
