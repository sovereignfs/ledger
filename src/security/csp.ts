/**
 * The Content-Security-Policy every page is sent with, and the headers that go with it (DESIGN.md §19, task 1.7).
 *
 * Payees, notes and names come from people, and a page shows money, so it must stay safe even if a way to put markup in them were found: nothing may run that the server did not mark, and nothing third-party may load.
 *
 *  - **Scripts** run only with this request's nonce, or when a script that has it loads them (`'strict-dynamic'`): the bundles Next adds, and the
 *    theme script in the layout. No inline handler, no `javascript:` address, no `eval` (but in development, where React wants it).
 *  - **Style *elements*** carry the nonce too. **Style *attributes* are allowed**: React's `style` props and the design system's overlays position
 *    things with them, and an attribute can change how something looks but cannot run anything.
 *  - **Everything else comes from this origin**: images (and `data:` and `blob:`), fonts (the design system's own, served from here), `connect-src`
 *    (the app's own routes and actions), the service worker (`worker-src`) and the manifest. No frames, no plugins, nobody may frame a page
 *    (`frame-ancestors`), forms go only here, `<base>` cannot be changed.
 *  - **`upgrade-insecure-requests`** only where the app is served over https: on `http://localhost` it would send the page's own requests to a port
 *    that does not speak https.
 *
 * The nonce is new for every request and unguessable; a page that uses it cannot be prerendered, which is why every page is rendered per request.
 */
export interface PolicyOptions {
  nonce: string;
  /** The app is served over https (`LEDGER_URL`). */
  secure: boolean;
  /** `next dev`, which needs `eval`. */
  development: boolean;
}

export function contentSecurityPolicy({ nonce, secure, development }: PolicyOptions): string {
  // `next dev`'s own overlay (the indicator at the bottom left, its menus and error dialog) draws itself with a dozen inline `<style>` elements inside
  // a shadow root, none of which can be given a nonce, so under the production policy it is left unstyled. Development only, and a nonce in the list
  // would make browsers ignore `'unsafe-inline'`, so it stands alone: the production policy below is the one that is tested and shipped.
  const styles = development ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src ${styles}`,
    `style-src-elem ${styles}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

/** An unguessable value for one request: 128 bits from the platform's random source. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Headers for every response, pages and APIs alike. `Strict-Transport-Security` is sent only over https, by the proxy. */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // A response is what its `Content-Type` says it is: an export or a note cannot be sniffed into a script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Old browsers do not know `frame-ancestors`.
  { key: 'X-Frame-Options', value: 'DENY' },
  // A link followed from a page does not tell the other site where it came from.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // Nothing here needs the device; a page cannot be made to ask for it.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // Another site's window cannot hold a reference to this one's after a link is followed.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** A year, and the subdomains: the app is served over https or not at all. */
export const HSTS = 'max-age=31536000; includeSubDomains';
