// `pnpm dev`: the development server, with the settings it needs made for you the first time.
//
// A fresh checkout has no settings, and the app's defaults are an operator's (an sqld service that is not running, and no way to sign in), so `next dev`
// alone stops at start-up. This writes `.env.local` once, for this machine only, and then starts `next dev` on port 3003:
//
//   - a SQLite file under ./data, which needs no Docker (`pnpm db:dev sqld | postgres` is for trying the other forms);
//   - the address people use, http://localhost:3003, which sign-in is made from;
//   - local sign-in, with a secret made here and never written anywhere else.
//
// `.env.local` is not tracked by git (`.env.*` is ignored) and is **never overwritten**: once it exists it is yours, and a value you put in your own shell
// wins over it, as Next does. Delete it to start again. Nothing else in the repository reads it but Next, and CI and the tests read the environment alone.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const file = resolve(root, '.env.local');
const PORT = '3003';

if (existsSync(file)) {
  console.info('[ledger] dev: using .env.local');
} else {
  mkdirSync(resolve(root, 'data'), { recursive: true });
  writeFileSync(
    file,
    [
      '# Made by `pnpm dev` for this machine. Yours to edit; delete it to have it made again. Not tracked by git.',
      '# Every setting Ledger reads is described in .env.example.',
      `LEDGER_URL=http://localhost:${PORT}`,
      'LEDGER_AUTH_LOCAL=1',
      `LEDGER_AUTH_SECRET=${randomBytes(48).toString('base64')}`,
      '# The first account is the only one; open sign-up with LEDGER_AUTH_SIGNUP=open.',
      'LEDGER_AUTH_SIGNUP=closed',
      'LEDGER_DB_DIALECT=sqlite',
      `LEDGER_SQLITE_URL=file:${resolve(root, 'data', 'ledger.db')}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.info(
    '[ledger] dev: made .env.local (a SQLite file in ./data, local sign-in) — see .env.example for every setting',
  );
}

const child = spawn('pnpm', ['exec', 'next', 'dev', '--port', PORT], {
  cwd: root,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
