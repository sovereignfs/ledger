import { type NextRequest, NextResponse } from 'next/server';
import { edgeSettings } from './src/config/edge';
import { HSTS, contentSecurityPolicy, newNonce } from './src/security/csp';

/**
 * **Every page is sent with a Content-Security-Policy** with a nonce of its own (`src/security/csp.ts`), so every page is rendered per request, the
 * landing page too. The proxy makes the nonce and puts the policy on the request, where Next reads it and puts the nonce on the scripts and styles
 * it makes, and the layout puts it on the theme script (`x-nonce`); it puts the policy on the response too, where the browser enforces it. An API's
 * answer is data, with no page to protect, so it gets only the headers every response has (`next.config.ts`).
 *
 * It keeps the Edge discipline: no Node built-ins and no database. It only looks at the request, so a session is for the page to check, and a
 * proxy is never the only thing standing in the way (DESIGN.md §5.2). The front address (task 2.2) joins it.
 */
const SIGN_IN_PAGES = new Set(['/sign-in', '/sign-up', '/forgot-password', '/reset-password']);

export function proxy(request: NextRequest) {
  const { secure, development, authLocal } = edgeSettings();
  const page = !request.nextUrl.pathname.startsWith('/api/');
  const nonce = newNonce();
  const policy = contentSecurityPolicy({ nonce, secure, development });

  const requestHeaders = new Headers(request.headers);
  // Set, never trusted: a nonce or a policy the client sent is replaced here, and an API's request carries neither.
  if (page) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', policy);
  } else {
    requestHeaders.delete('x-nonce');
    requestHeaders.delete('content-security-policy');
  }

  // Off means off (DESIGN.md §13.1): with local sign-in off, the sign-in pages are not there. A page cannot say so itself: the root loading state has
  // already sent a 200 by the time it would, so the proxy answers with the page that is not found, and its status.
  const absent = !authLocal && SIGN_IN_PAGES.has(request.nextUrl.pathname);
  const response = absent
    ? NextResponse.rewrite(new URL('/not-found', request.url), {
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });
  if (page) response.headers.set('content-security-policy', policy);
  if (secure) response.headers.set('strict-transport-security', HSTS);
  return response;
}

/** Everything but the build's own static files, which are not pages and are the same for everyone (and cannot carry a nonce), and prefetches. */
export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|sw.js|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
