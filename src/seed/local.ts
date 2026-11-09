import type { DatabaseConfig } from '../db/config';

/**
 * Whether a database is **on this machine**, which is the only kind the seed writes to (DESIGN.md §19): a file, or a service at `localhost`, `127.0.0.1`, `::1` or
 * a name ending `.localhost`. **Pure**, and strict: a URL that cannot be read, or whose host is anything else (an address on a network, a name like
 * `sqld` or `db.example.com` that only a container network or the internet can reach), is not local.
 */
export function isLocalDatabase(config: DatabaseConfig): boolean {
  if (config.dialect === 'sqlite' && config.form === 'file') return true;
  try {
    const host = new URL(config.url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}
