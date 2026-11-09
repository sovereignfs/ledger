/**
 * The service worker (DESIGN.md §14.6), as the text served at `/sw.js`. It is a string and not a module because a worker is its own script, with no bundler between it
 * and the browser; it is written here, with a version and the build's files put in, so that a test evaluates the very text that is served.
 *
 * **What it keeps, and nothing else:** the build's own files (the allow-list `files`, all under `/_next/static/`, the same for everyone), the icons and the manifest.
 * **No page is kept, and no answer from the server**: a page of Ledger has a person's money on it, so every navigation, every API request and every other file goes to
 * the network as it would without a worker, and what comes back is never stored. **With no network,** a page is answered with one the worker builds itself, saying that
 * Ledger needs a connection (it holds nothing of a person, and no script). A new version waits until the pages that use the old one are closed (no `skipWaiting`).
 */
export const CACHE_PREFIX = 'ledger-shell-';

export function workerSource(version: string, files: readonly string[] = []): string {
  return `'use strict';
const CACHE = ${JSON.stringify(CACHE_PREFIX + version)};
const PREFIX = ${JSON.stringify(CACHE_PREFIX)};
/** The build's own files, which are kept when the worker installs: the allow-list of what the app is made of, the same for everyone. */
const FILES_OF_THE_BUILD = ${JSON.stringify(files)};
const BUILT = /^\\/_next\\/static\\//;
const FILES = /^\\/(icon\\.svg|favicon\\.ico|manifest\\.webmanifest|icons\\/[a-z0-9._-]+)$/;

const OFFLINE_PAGE = ${JSON.stringify(offlineHtml())};

function offline() {
  return new Response(OFFLINE_PAGE, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'cache-control': 'no-store',
    },
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // A few at a time, none of it from a person's session: the same files for everyone.
      for (let i = 0; i < FILES_OF_THE_BUILD.length; i += 8) {
        await Promise.all(FILES_OF_THE_BUILD.slice(i, i + 8).map((file) => cache.add(new Request(self.location.origin + file)).catch(() => undefined)));
      }
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name))),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  if (BUILT.test(url.pathname) || FILES.test(url.pathname)) {
    event.respondWith(kept(event, request));
  }
  // Anything else is not the worker's: it goes to the network as it would without one, and is never stored.
});

/** A built file or an icon: from the cache if it is there, else from the network and kept. They are the same for everyone. */
async function kept(event, request) {
  const cache = await caches.open(CACHE);
  const found = await cache.match(request);
  if (found) return found;
  const response = await fetch(request);
  if (response.ok && response.type !== 'opaque') event.waitUntil(cache.put(request, response.clone()));
  return response;
}

/** A page is the network's, always: what it holds is a person's. With none, the page that says so. */
async function navigate(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return offline();
  }
}
`;
}

/** The page the worker builds for an address it cannot answer without a connection: plain, with no script and nothing of a person. */
function offlineHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Needs a connection · Ledger</title><style>body{font-family:system-ui,sans-serif;margin:0;display:grid;min-height:100vh;place-items:center;background:#fff;color:#111}main{max-width:28rem;padding:1.5rem}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}}</style></head><body><main><h1>Ledger needs a connection</h1><p>Your accounts, budget and entries are read from your server, and none of them is kept on this device, so they are not here while you are offline. Try again when you are back online.</p></main></body></html>`;
}

/**
 * The worker for a server that is not a production build (`next dev`): it keeps nothing, and removes itself and the caches of any other. A worker that kept files there
 * would show yesterday's code, since a development server's files do not change their names when they change.
 */
export function inertWorkerSource(): string {
  return `'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(${JSON.stringify(CACHE_PREFIX)})).map((name) => caches.delete(name))))
      .then(() => self.registration.unregister()),
  );
});
`;
}
