# Ledger

Your budget, your accounts and your net worth, in every currency you use. Ledger runs on its own or on a
[Sovereign](https://github.com/sovereignfs/sovereign) instance.

It is a two-sided ledger: an account's balance is the sum of what was entered against it, every expense says which account paid it, and a budget
keeps its history so that a past month shows what was planned then. It replaces the Sovereign ledger plugin; none of its code is carried over.

**What it does:** accounts of every kind (bank, cash, savings, cards, loans, investments, property, people you lend to or owe) with an opening balance;
expenses, income and transfers with splits and payees; a budget by category and subcategory with history; bills that post themselves or ask first,
and loans that pay themselves down; saving jars; reports for a month and a year, net worth over time and insights; a monthly recap; every currency, with
daily exchange rates; export and import of the whole book as one file; and an installable app (a PWA) that keeps no page with money on it.

**Status: version 0.1.0 is being prepared.** The charts of the reports wait on the design system, which has none yet. [`DESIGN.md`](DESIGN.md) says what
Ledger is and how it is built, [`ROADMAP.md`](ROADMAP.md) puts the work in order, [`docs/epics/`](docs/epics/) holds each task, and
[`docs/security-review-phase-1.md`](docs/security-review-phase-1.md) records the review of what is built.

## Run it

You need Docker. Ledger is one image, `ghcr.io/sovereignfs/ledger`, and the smallest way to run it is one container on a SQLite file:

```bash
docker run -d --name ledger -p 127.0.0.1:3003:3003 -v ledger:/data \
  -e LEDGER_DB_DIALECT=sqlite -e LEDGER_SQLITE_URL=file:/data/ledger.db \
  -e LEDGER_URL=http://localhost:3003 -e LEDGER_AUTH_LOCAL=1 \
  -e LEDGER_AUTH_SECRET="$(openssl rand -base64 48)" -e LEDGER_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/sovereignfs/ledger
```

Open <http://localhost:3003> and **make an account**: the first one is the only one unless you open sign-up (`LEDGER_AUTH_SIGNUP=open`). Setup then asks for
your base currency and time zone and offers to make your first categories and budgets. Everything after that is in the app.

The two generated values are in no file, so **keep them**: `LEDGER_AUTH_SECRET` signs sessions (changing it signs everyone out) and `LEDGER_ENCRYPTION_KEY`
seals any credential the app keeps. For anything but your own machine, put a reverse proxy with TLS in front, and set `LEDGER_URL` to the address people use
(the server refuses to start on an address that is not https, localhost aside): passkeys, emailed links and the sign-in redirect are made from it.

For a database service, or for PostgreSQL, use the Compose setups in [`deploy/`](deploy/README.md), which also say what the server does at start-up, how to back
it up and how to update it. The same image runs on all three.

## Settings

Every setting is an environment variable that starts `LEDGER_`, declared once and checked at start-up: a wrong one stops the server, naming it and never its
value. [`.env.example`](.env.example) lists them with their defaults and says what each is for. A secret may be given as `NAME_FILE=/path` instead.

| Setting                                                                 | What it is                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `LEDGER_URL`                                                            | The address people use (https, but http for localhost), with no path. **Required.**                                |
| `LEDGER_DB_DIALECT`                                                     | `sqld` (the default), `sqlite` or `postgres`.                                                                      |
| `LEDGER_SQLD_URL`, `LEDGER_SQLD_ADMIN_URL`                              | sqld's service address and its admin address.                                                                      |
| `LEDGER_SQLITE_URL`                                                     | A `file:` for one container (never a network filesystem).                                                          |
| `LEDGER_POSTGRES_URL`, `PGSSLROOTCERT`, `LEDGER_POSTGRES_POOL_MAX`      | PostgreSQL's address, a root certificate for TLS, and the most connections.                                        |
| `LEDGER_DB_CONNECT_TIMEOUT_MS`, `LEDGER_MIGRATIONS_DIR`                 | How long to wait for a database that is starting (30000), and where the migrations are if not beside the server.   |
| `LEDGER_AUTH_LOCAL`                                                     | `1` for email and password, passkeys and two-factor.                                                               |
| `LEDGER_AUTH_SECRET`                                                    | 32 characters or more. **Required** with any way of signing in.                                                    |
| `LEDGER_AUTH_SIGNUP`, `LEDGER_AUTH_PASSWORD_MIN_LENGTH`                 | `closed` (the first account only) or `open`; the shortest password (10).                                           |
| `LEDGER_CORE_URL`, `LEDGER_CORE_CLIENT_ID`, `LEDGER_CORE_CLIENT_SECRET` | Sign in through a Sovereign instance's core, all three together.                                                   |
| `LEDGER_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM`              | Mail: verified addresses, reset links, and the recap where core is not sending it. Without a host none is offered. |
| `LEDGER_ENCRYPTION_KEY`, `LEDGER_ENCRYPTION_KEY_PREVIOUS`               | Seals credentials the app keeps; the second is for changing the first.                                             |
| `LEDGER_FX`, `LEDGER_FX_URL`                                            | `off` stops the daily exchange-rate fetch; a mirror of Frankfurter.                                                |
| `LEDGER_WORKER`                                                         | `off` runs no jobs in this process, for all but one of several that share a database.                              |

**Exchange rates:** once a day the server asks [Frankfurter](https://frankfurter.dev) for the rate of each currency someone has added. Only currency codes are
sent, never an amount, a name or an account. With `LEDGER_FX=off` amounts in other currencies are reported as not included, never counted as nothing.

## On a Sovereign instance

`sv app add` hosts Ledger from `sovereign.manifest.json`, which is also the image's label; it needs core **0.80.0** or later. The instance gives the app its
database and its address, and people sign in through it with no password to find. Grant the app the notification, email and activity scopes to have the
recap and the bills waiting in the bell, in email and on the activity page; without them everything else works and nothing is sent.
[`deploy/README.md`](deploy/README.md) § On a Sovereign instance has the settings it sets.

## Your data

- **Backups are the operator's:** the database is the whole of it. [`deploy/README.md`](deploy/README.md) § Backups says how for each form.
- **Export and import are the person's:** Settings, Data downloads the whole book as one file and imports it into an empty book. It is neither a substitute for
  a backup nor the reverse.
- **Deleting an account** removes everything of the person, and says what goes before it asks.

## Develop

You need Node 24.15 or newer and [pnpm](https://pnpm.io) (the version is `packageManager` in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm dev   # http://localhost:3003; the first time it makes .env.local (a SQLite file in ./data, local sign-in)
pnpm seed  # after signing up: a year of data in your book (a local database only)
```

How to work on it is in [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md); how a release is made is in [`RELEASING.md`](RELEASING.md).

## Licence

AGPL-3.0-or-later. Bundling `@sovereignfs/ui` makes it so, and every dependency's licence must be compatible.
