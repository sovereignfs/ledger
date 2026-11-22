import { serviceWorkerSource } from '@sovereignfs/pwa';

/**
 * The service worker (DESIGN.md §14.6), as the text served at `/sw.js`: the suite's, from `@sovereignfs/pwa`, with Ledger's version, cache name and built files.
 * It is a string and not a module because a worker is its own script, with no bundler between it and the browser; a test evaluates the very text that is served.
 *
 * **What it keeps, and nothing else:** the build's own files (the allow-list `files`, all under `/_next/static/`, the same for everyone), the icons and the manifest.
 * **No page is kept, and no answer from the server**: a page of Ledger has a person's money on it, so Ledger gives the worker no shell, and every navigation, every
 * API request and every other file goes to the network as it would without a worker, and what comes back is never stored. **With no network,** or none in time, a
 * page is answered with one the worker builds itself, saying the app is offline (it holds nothing of a person, and no script). A new version waits until a page
 * asks it to take over, which the registration does when the person chooses Reload (`ServiceWorkerRegistration`).
 */
export const CACHE_PREFIX = 'ledger-shell-';

export function workerSource(version: string, files: readonly string[] = []): string {
  return serviceWorkerSource({
    version,
    cachePrefix: CACHE_PREFIX,
    precache: files,
    // The design system's grey 900 and white, as the manifest's colours are.
    offlineColors: { light: ['#ffffff', '#18181b'], dark: ['#18181b', '#fafafa'] },
  });
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
