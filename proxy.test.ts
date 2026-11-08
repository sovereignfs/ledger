import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

const request = (path: string, base = 'https://ledger.example.com') =>
  new NextRequest(`${base}${path}`);

/** The `x-middleware-request-*` headers Next copies onto a response: what the page will see as its request's. */
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

afterEach(() => vi.unstubAllEnvs());

describe('the proxy', () => {
  it('sends a page with a Content-Security-Policy that carries the nonce the page is given', () => {
    vi.stubEnv('LEDGER_URL', 'https://ledger.example.com');
    const response = proxy(request('/'));
    const policy = response.headers.get('content-security-policy') ?? '';
    const nonce = forwarded(response, 'x-nonce') ?? '';
    expect(nonce).not.toBe('');
    expect(policy).toContain(`'nonce-${nonce}'`);
    // The page's own copy of the request is given the same policy, which is where Next reads the nonce from.
    expect(forwarded(response, 'content-security-policy')).toBe(policy);
  });

  it('makes a new nonce for every request', () => {
    const nonces = new Set(
      Array.from({ length: 50 }, () => forwarded(proxy(request('/budget')), 'x-nonce')),
    );
    expect(nonces.size).toBe(50);
  });

  it('puts the policy on every kind of page: the landing page, a screen, a missing route and sign-in', () => {
    for (const path of ['/', '/transactions', '/no-such-page', '/sign-in', '/account']) {
      expect(proxy(request(path)).headers.get('content-security-policy'), path).toContain(
        "script-src 'self' 'nonce-",
      );
    }
  });

  it('does not make a page of an API: its answer is data, and has no nonce to leak', () => {
    for (const path of ['/api/health', '/api/export']) {
      const response = proxy(request(path));
      expect(response.headers.get('content-security-policy'), path).toBeNull();
      expect(forwarded(response, 'x-nonce'), path).toBeNull();
    }
  });

  it('never trusts a nonce or a policy that the client sent, to a page or to an API', () => {
    const hostile = (path: string) =>
      new NextRequest(`https://ledger.example.com${path}`, {
        headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src 'unsafe-inline'" },
      });
    const response = proxy(hostile('/'));
    expect(forwarded(response, 'x-nonce')).not.toBe('attacker');
    const policy = forwarded(response, 'content-security-policy') ?? '';
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).toContain(`'nonce-${forwarded(response, 'x-nonce')}'`);
    const api = proxy(hostile('/api/health'));
    expect(forwarded(api, 'x-nonce')).toBeNull();
    expect(forwarded(api, 'content-security-policy')).toBeNull();
  });

  it('never allows unsafe-inline for scripts, in any request', () => {
    for (const path of ['/', '/sign-in', '/budget', '/no-such-page']) {
      const policy = proxy(request(path)).headers.get('content-security-policy') ?? '';
      const script = policy.split('; ').find((directive) => directive.startsWith('script-src'));
      expect(script, path).not.toContain('unsafe-inline');
    }
  });

  it('sends HSTS over https only', () => {
    vi.stubEnv('LEDGER_URL', 'https://ledger.example.com');
    expect(proxy(request('/')).headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    vi.stubEnv('LEDGER_URL', 'http://localhost:3003');
    expect(
      proxy(request('/', 'http://localhost:3003')).headers.get('strict-transport-security'),
    ).toBeNull();
  });

  it('upgrades insecure requests only where the app is served over https', () => {
    vi.stubEnv('LEDGER_URL', 'http://localhost:3003');
    expect(
      proxy(request('/', 'http://localhost:3003')).headers.get('content-security-policy'),
    ).not.toContain('upgrade-insecure-requests');
    vi.stubEnv('LEDGER_URL', 'https://ledger.example.com');
    expect(proxy(request('/')).headers.get('content-security-policy')).toContain(
      'upgrade-insecure-requests',
    );
  });
});

describe('what the proxy looks at', () => {
  const [matcher] = config.matcher;
  const matches = (path: string) => new RegExp(`^${matcher?.source}$`).test(path);

  it('is every request but the build’s static files and the icons, which cannot carry a nonce', () => {
    for (const path of ['/', '/budget', '/api/health', '/sign-in', '/shell', '/iconsx']) {
      expect(matches(path), path).toBe(true);
    }
    // The worker and the manifest are files, not pages, and carry no policy of a page.
    for (const path of [
      '/_next/static/chunks/a.js',
      '/_next/image',
      '/favicon.ico',
      '/icon.svg',
      // The app's icons (the manifest's `icon` is one), served to a launcher that has no session here.
      '/icons/icon.svg',
      '/icons/icon-192.png',
      '/sw.js',
      '/manifest.webmanifest',
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it('leaves out prefetches, which are not pages', () => {
    expect(matcher?.missing).toEqual([
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ]);
  });
});
