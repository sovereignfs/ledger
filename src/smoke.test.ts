import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name: string;
  license: string;
  engines: { node: string };
  scripts: Record<string, string>;
};

// A runner that finds no tests passes silently; this one reads something real, so a broken runner or a wrong working directory fails.
describe('the package', () => {
  it('is Ledger, under the suite’s licence, on the suite’s Node', () => {
    expect(pkg.name).toBe('@sovereignfs/ledger');
    expect(pkg.license).toBe('AGPL-3.0-or-later');
    expect(pkg.engines.node).toBe('>=24.15 <25');
  });

  it('runs on its own port, 3003', () => {
    // `pnpm dev` is scripts/dev.mjs, which starts next dev on that port.
    expect(pkg.scripts.dev).toBe('node scripts/dev.mjs');
    expect(readFileSync('scripts/dev.mjs', 'utf8')).toContain("const PORT = '3003'");
    expect(pkg.scripts.start).toContain('3003');
  });
});
