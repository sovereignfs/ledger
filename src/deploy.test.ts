import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the image and the setups promise, held to the things that must agree with them (DESIGN.md §19). They are written in several places that
 * cannot import each other (a Dockerfile, three Compose files, a workflow, a manifest), so a test keeps them one.
 */
const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

const manifest = JSON.parse(read('sovereign.manifest.json')) as { port: number };
const composeFiles = ['deploy/compose.yaml', 'deploy/compose.file.yaml'];

describe('the image', () => {
  const dockerfile = read('Dockerfile');

  it('runs on Debian, not Alpine: libSQL’s native client has no build for musl, and the `file:` form loads it', () => {
    const bases = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((match) => match[1]);
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) expect(base).toMatch(/bookworm/);
    expect(bases.join(' ')).not.toMatch(/alpine/);
  });

  it('is not root, and takes its port from the manifest’s build argument and stops without it', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^ARG PORT$/m);
    expect(dockerfile).toMatch(/test -n "\$\{PORT\}"/);
    expect(dockerfile).toMatch(/^EXPOSE \$\{PORT\}$/m);
    expect(dockerfile).toMatch(/PORT=\$\{PORT\}/);
  });

  it('copies the migrations beside the server, and the licences', () => {
    expect(dockerfile).toContain('/app/migrations ./migrations');
    expect(dockerfile).toContain('/usr/share/licenses/ledger/LICENSE');
    expect(dockerfile).toContain('/usr/share/licenses/sovereignfs-ui/NOTICE');
  });

  it('copies pnpm-workspace.yaml before it installs, which carries the platforms the lockfile covers', () => {
    expect(dockerfile).toMatch(/COPY package\.json pnpm-lock\.yaml pnpm-workspace\.yaml/);
  });
});

describe('what the build is sent', () => {
  it('leaves out an environment file at any depth: they hold secrets, and deploy/.env is not at the root', () => {
    const ignored = read('.dockerignore')
      .split('\n')
      .map((line) => line.trim());
    expect(ignored).toContain('**/.env');
    expect(ignored).toContain('**/.env.*');
    expect(ignored).toContain('deploy');
  });
});

describe('the setups', () => {
  it.each([...composeFiles])(
    '%s builds with the manifest’s port, which Compose cannot read',
    (file) => {
      const compose = read(file);
      expect(compose).toContain(`PORT: '${manifest.port}'`);
      expect(compose).toContain(`:${manifest.port}'`);
    },
  );

  it('run on the manifest’s port on a developer’s machine too, so the suite’s apps can run side by side', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    // `pnpm dev` is scripts/dev.mjs, which starts next dev on the manifest's port and makes the address people use from it.
    expect(scripts.dev).toBe('node scripts/dev.mjs');
    const dev = read('scripts/dev.mjs');
    expect(dev).toContain(`const PORT = '${manifest.port}'`);
    expect(dev).toContain("'--port', PORT");
    expect(dev).toContain('LEDGER_URL=http://localhost:${PORT}');
    expect(scripts.start).toContain(`PORT=\${PORT:-${manifest.port}}`);
    expect(read('.env.example')).toContain(`LEDGER_URL=http://localhost:${manifest.port}`);
  });

  it('reach an sqld that is pinned, at the version CI runs, and a PostgreSQL that is too', () => {
    const ci = read('.github/workflows/ci.yml');
    const sqld = /SQLD_IMAGE: (\S+)/.exec(ci)?.[1];
    const postgres = /POSTGRES_IMAGE: (\S+)/.exec(ci)?.[1];
    expect(sqld).toBeTruthy();
    expect(postgres).toBeTruthy();
    expect(read('deploy/compose.yaml')).toContain(`image: ${sqld}`);
    expect(read('deploy/compose.postgres.yaml')).toContain(`image: ${postgres}`);
  });

  it('publish nothing but the app’s own port, and only to the machine itself', () => {
    for (const file of composeFiles) {
      for (const [, mapping] of read(file).matchAll(/^\s+- '([^']*:[^']*)'$/gm)) {
        expect(mapping, file).toMatch(/^127\.0\.0\.1:/);
      }
    }
    expect(read('deploy/compose.yaml')).not.toMatch(/8080:|8081:/);
  });

  it('select their database by name, and never leave it to be guessed', () => {
    expect(read('deploy/compose.yaml')).toContain('LEDGER_DB_DIALECT: sqld');
    expect(read('deploy/compose.file.yaml')).toContain('LEDGER_DB_DIALECT: sqlite');
    expect(read('deploy/compose.postgres.yaml')).toContain('LEDGER_DB_DIALECT: postgres');
  });

  it('ask for a password for PostgreSQL rather than carrying one', () => {
    expect(read('deploy/compose.postgres.yaml')).toContain('${POSTGRES_PASSWORD:?');
  });
});

describe('the example environment of a deployment', () => {
  it('names only settings the app reads, which are described in the repository’s own example', () => {
    const own = read('.env.example');
    const deploy = read('deploy/.env.example');
    const names = [...deploy.matchAll(/^#? ?(LEDGER_[A-Z0-9_]+)=/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(names.length).toBeGreaterThan(3);
    // LEDGER_PORT is Compose's: the port on the machine, which the app never reads.
    for (const name of names.filter((n) => n !== 'LEDGER_PORT')) {
      expect(own, name).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
    }
  });
});
