// `pnpm seed [--reset | --remove] [--email you@example.com]`: a book worth looking at, for development (DESIGN.md §19).
//
// It fills the book of an account that has signed in (the oldest, or the one named with --email) with a year of realistic data, made through the same code the
// screens use. **It refuses a database that is not on this machine.** `--reset` empties the book first and `--remove` only empties it; without either, a book that
// has accounts is left alone. The settings are read as the server reads them, from the environment and from `.env.local` when there is one (`pnpm dev` makes it).
//
//   pnpm dev        # once, and sign up at http://localhost:3003/sign-up
//   pnpm seed
import { sql } from 'drizzle-orm';
import { getConfig } from '../src/config/current';
import { getStores } from '../src/db/boot';
import { dbGet } from '../src/db/exec';
import { tableNamed } from '../src/db/tables';
import { ensureBook } from '../src/ledger/books';
import { isLocalDatabase } from '../src/seed/local';
import { clearBook, seedBook } from '../src/seed/seed';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const emailAt = args.indexOf('--email');
const email = emailAt >= 0 ? args[emailAt + 1] : undefined;
const unknown = args.filter(
  (arg, at) => !['--reset', '--remove', '--email'].includes(arg) && args[at - 1] !== '--email',
);
if (unknown.length > 0 || (emailAt >= 0 && !email) || (flag('--reset') && flag('--remove'))) {
  console.error('usage: pnpm seed [--reset | --remove] [--email you@example.com]');
  process.exit(2);
}

const settings = getConfig().database;
if (!isLocalDatabase(settings.database)) {
  console.error(
    '[ledger] seed: this database is not on this machine, and the seed writes only to one that is. Nothing was changed.',
  );
  process.exit(1);
}

const stores = await getStores(settings);
try {
  const user = await dbGet<{ id: string; email: string }>(
    stores.auth,
    email
      ? sql`SELECT u.id AS id, u.email AS email FROM ${tableNamed(stores.auth, 'user')} u WHERE lower(u.email) = ${email.toLowerCase()}`
      : sql`SELECT u.id AS id, u.email AS email FROM ${tableNamed(stores.auth, 'user')} u ORDER BY u.created_at LIMIT 1`,
  );
  if (!user) {
    console.error(
      email
        ? `[ledger] seed: no account has the address ${email}.`
        : '[ledger] seed: there is no account yet. Sign up first (the first account is made at /sign-up), then run the seed.',
    );
    process.exit(1);
  }
  const book = await ensureBook(stores.app, user.id);
  if (flag('--reset') || flag('--remove')) {
    await clearBook(stores.app, book.id);
    console.info(`[ledger] seed: the book of ${user.email} is empty.`);
  }
  if (!flag('--remove')) {
    const summary = await seedBook(stores.app, user.id, book.id);
    console.info(
      `[ledger] seed: ${summary.accounts} accounts, ${summary.entries} entries over ${summary.months} months, ${summary.recurring} recurring entries and ${summary.jars} jars, in the book of ${user.email}.`,
    );
  }
} catch (error) {
  console.error(`[ledger] seed: ${error instanceof Error ? error.message : 'it failed'}`);
  process.exitCode = 1;
} finally {
  await stores.close();
}
