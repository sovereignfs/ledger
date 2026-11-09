# AGENTS.md

Guidance for every AI agent working in this repository (Codex reads this file directly; Claude Code loads it through `CLAUDE.md`). It is
the one copy of the conventions. Do not duplicate them elsewhere, and do not add task history or release narrative to it: those belong
in `ROADMAP.md`, the task's epic and the PR body.

This repository follows the conventions of [`sovereignfs/sovereign`](https://github.com/sovereignfs/sovereign) (its `AGENTS.md`,
`docs/building-an-app.md` and `docs/development-workflow.md`) and of [`sovereignfs/tusk`](https://github.com/sovereignfs/tusk) (its `AGENTS.md`,
the closest model: an app of its own built from a roadmap). Where this file is silent, do what Tusk does; where they differ, this file says which.

## What this is

**Ledger**, an app of the Sovereign suite exactly as Tusk and Fjord are: a person's budget, their accounts and their net worth, in every currency they
use. It is a **two-sided ledger**: a money account's balance is the sum of its lines, and every expense says which account paid it. A Sovereign
instance can host it, and it also runs fully self-hosted, needing no instance. It replaces the legacy plugin `sovereignfs/sovereign-plugin-ledger`,
whose behaviour is the starting point and none of whose code or data is carried over. It is a PWA on Next.js, with its own database (sqld, a SQLite
file or PostgreSQL), signing people in locally, through a Sovereign core, or both, from one image.

**What is built:** the foundation (Milestone A: settings, the database on three forms, the job runner, the policy and headers, the shell, browser tests, the
image and its setups) and the first people's part (Milestone B: local sign-in, the book and the permission, the landing page, deleting a person, Settings, and
amounts and currencies), and the ledger (Milestone C: exchange rates and conversion, the one write path for transactions, money accounts, categories, the add dialog, splits, payees, transfers, the list, reconciling and revaluation). The budget (history, income, the screen), setup and Overview (Milestone D) are built too, and so are recurring entries (the rule, posting, upcoming, bills in the budget, loan instalments); jars too (earmarks, monthly contributions, spending from a jar), and a development seed; and reports (the month, the year, net worth over time, the review, insights; their charts wait on the design system, 8.4), sign-in through a core, the notices it sends (the daily bills, an insight, the recap), and export and import. `DESIGN.md` is the design, `ROADMAP.md` the order.

## Source of truth

Read the relevant document before a task. Where two disagree, the earlier one wins and the later one is stale and should be fixed:

1. **The contracts Sovereign publishes**, in the `sovereign` repository: `contracts/app-manifest.md`, `contracts/env.md`, `docs/using-the-sdk.md` and
   `docs/specs/sdk.md`, `docs/specs/design-system.md` and `docs/design-system.md`, `docs/connecting-an-app.md`. A gap is raised in `sovereign`, not
   patched here.
2. **`DESIGN.md`**: what Ledger is and how it is built, with numbered sections that tasks cite.
3. **`ROADMAP.md`**: the order of work, one row per task, canonical for status.
4. **`docs/epics/`**: each task's detail (goal, "Accepts when", and once done, how it was done and what was left out).

Directories are created when they are needed. Research (`docs/research/`), RFCs (`docs/rfcs/`), ADRs (`docs/adrs/`) and workstreams
(`docs/workstreams/`) are used as Sovereign and Tusk use them. A documented "not now" is a valid outcome.

## Planning workflow

- **The developer assigns the task** at the start of a session. There is no "next task" pointer in any file; read `ROADMAP.md` for the queue and ask
  which to pick up.
- **Task IDs are permanent** (`4.3`): use them in cross-references and dependency lists, never in branch names, commit messages or PR titles.
- **A finished task is marked done in its roadmap row and written up in its epic** (Done as: what, where, what was left out), in the same change as
  the work.
- **Copying from Tusk is said, not hidden:** a task that copies a file names it in its Done as, and changes in behaviour from Tusk's are stated.

## Working conventions

- **One task, one branch, one draft PR.** Branch from an up-to-date `main`, named `feat/<slug>`, `fix/<slug>`, `docs/<slug>` or `chore/<slug>`. Do not
  start a second task on a branch whose PR is not merged.
- **Nothing goes to `main` directly,** except the owner's bypass, which is theirs to use.
- **Never commit or push without being asked.** Prepare changes in the working tree and stop.
- **Commits explain why.** `type(scope): summary` under 72 characters, body wrapped at 100, a `Verified:` line naming what was run, one logical change
  per commit. Every commit an agent makes ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`: model-agnostic, never a specific model
  name.
- **PRs target `main`, are opened as drafts** (`gh pr create --draft --base main`), and are marked ready only on instruction. The body says what changed
  and why, cites the `DESIGN.md` section, carries no task numbers, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Merge with rebase and merge,** never squash and never a merge commit. **Never merge a PR automatically.**
- **Verify before claiming done.** Run the commands under Commands and show the output. A regression test is trusted only after it has been seen to
  fail against the code it guards.
- **Docs are part of the change.** A statement a change makes false is fixed in the same PR; a change to behaviour adds a line under `## [Unreleased]`
  in `CHANGELOG.md`.
- **Releases are their own PR,** as Tusk's: `scripts/release.sh`, a `vX.Y.Z` tag publishes the image. A patch has no migration and no setting change.
- **Flag Docker-config impact immediately:** a new setting, port, path or native dependency updates the `Dockerfile` and `.dockerignore` in the same
  change.

## Rules of an app

Tusk's rules, as they apply to an online app, and Ledger's own. They describe the app as `DESIGN.md` designs it.

- **An account is known by its better-auth user id (`account_id`).** A `sub` is looked up only for core's notices and never matched to an account by
  email.
- **Everything of a person is deleted by `People.deletePerson`** (`src/sovereign/people.ts`), safe to run twice. **A new table is deleted there, and
  exported and imported, in the same change,** with a test that seeds one of each.
- **Every row of a book carries `book_id`, and the permission is in the statement:** membership of the book as a condition of the same query
  (`DESIGN.md` §5.2), never checked first and then touched. Anything a write points at must be the same book's, in the same statement. **A refusal
  reads as not found.** A route or server action finds the session first, checks `Origin` on a write, is listed in `src/access/routes.ts`, and has a
  test calling it as a second person.
- **Money is integer minor units, always** (`DESIGN.md` §9.1). No floating point touches an amount; a rate is a decimal string; conversion and rounding
  (half to even) happen only in `src/money/`. An amount with no rate is reported as not included, never counted as zero.
- **A balance is derived, never written.** It is the sum of an account's lines. A correction is an `adjustment` transaction; nothing edits a balance.
- **Every transaction is written through `src/ledger/`'s one path,** whose validators hold that lines add up (`DESIGN.md` §6.2) and that every line
  names exactly one target. Recurring posting, jars, loans and import use the same path. The invariant property test passes.
- **A past month is never rewritten by a budget change:** budgeted amounts are effective-dated rows (`DESIGN.md` §7.3).
- **A job claims its work in the database** and is safe to run twice and from two processes; a posting from a recurring entry is unique on
  `(recurring_id, occurrence_date)`.
- **Report figures and insights are pure functions over rows,** shared by the screens, the recap and the tests; one figure has one implementation.
- **Logs hold no amounts, names, payees or notes:** an id and a kind of failure. Nothing of a book leaves the server except the currency codes sent for
  rates, and what core is asked to deliver.
- **The database has three forms and two dialects:** a schema and migrations per dialect, generated with `pnpm db:generate`, never written by hand or
  `push`ed; standard SQL, values bound; no `LISTEN/NOTIFY`, trigger, extension or foreign key; every deletion names what it deletes, in a transaction;
  short transactions, nothing held across a call to core or Frankfurter. A data-layer test runs on sqld, a `file:` database and PostgreSQL. **Tests
  read `LEDGER_TEST_*` and never the app's variables.**
- **A released migration is never edited:** a fix is a new migration.
- **A credential is stored only through `src/crypto/`** (envelope encryption under `LEDGER_ENCRYPTION_KEY`). Secrets never appear in an error, a log, a
  URL or the browser.
- **The manifest is the one copy** (`sovereign.manifest.json`) of what an instance reads. `pnpm manifest:check` passes, and the image is built with
  `pnpm exec sovereign-manifest docker-args`.
- **Environment variables carry the prefix `LEDGER_`,** declared once through `@sovereignfs/config`; every one is in `.env.example`; the server refuses
  to start on a wrong setting; no secret has a default; never `NEXT_PUBLIC_*` for a value that varies at run time.
- **The design system is imported from `@sovereignfs/ui` directly,** pinned exactly; style with `--sv-*` tokens only; Hanken Grotesk served by the app.
  **Reusable UI (charts first of all) is built in `@sovereignfs/ui` in `sovereign`, released, then used,** never forked here.
- **Never fork a navigation decision by viewport;** fork only what is rendered.
- **The service worker caches the shell only,** by allow-list; no page with money on it is ever cached.
- **No third-party loads and no third-party requests from the browser.** What people write is rendered as text, never as HTML.
- **User-facing words are "budgeted", "spent", "subcategory", "account", "app"** (`DESIGN.md` §4), never "predicted", "actual", "kind", "debit",
  "client" or "plugin".
- **Next.js tracks the latest stable release.** Read the guide bundled with the installed version (`node_modules/next/dist/docs/`) before writing
  Next code.
- **TypeScript is strict.** No `any` without a comment; prefix an intentionally unused identifier with `_`; never disable a lint rule inline without a
  comment.

## pnpm

As Tusk's: `pnpm install --frozen-lockfile` for every routine install; `pnpm-workspace.yaml` carries pnpm's settings and the Dockerfile copies it;
pnpm refuses a release less than a day old and an install script nobody decided on; an exception in `minimumReleaseAgeExclude` only for a package of
ours, exact-pinned. Never accept pnpm's offer to add one.

## Commands

```bash
pnpm install --frozen-lockfile   # routine install
pnpm dev                         # next dev, on port 3003 (scripts/dev.mjs makes .env.local the first time: a SQLite file in ./data, local sign-in)
pnpm format / format:check       # Prettier
pnpm lint / lint:fix             # ESLint
pnpm typecheck                   # next typegen && tsc --noEmit
pnpm test                        # Vitest; the data layer runs on the database LEDGER_TEST_* names (a SQLite file with none)
pnpm db:generate <name>          # migrations for both dialects and both stores, from the schemas
pnpm db:dev sqld | postgres      # a local database in Docker (not needed: a file: URL works)
pnpm seed [--reset|--remove]     # a year of data in the book of the account that signed in (a local database only; sign up first)
pnpm generate:currencies         # regenerate src/money/currencies.ts from ICU
pnpm manifest:check              # sovereign.manifest.json is a valid manifest
pnpm build                       # next build (standalone)
pnpm boot-check                  # after pnpm build: a fresh instance boots on the database in the environment
pnpm e2e                         # after pnpm build: browser tests (pnpm exec playwright install chromium webkit once)
pnpm e2e:fast                    # after pnpm build: the same, in shards at once (scripts/e2e-shard.mjs)
scripts/deploy-check.sh          # every setup of deploy/, from nothing (needs the image: see deploy/README.md)
scripts/test-ci-changes.sh       # the CI classifier's tests
scripts/test-release.sh          # the release script's tests, against throwaway repositories
scripts/release.sh check|prepare|propose|tag|verify X.Y.Z   # a release (RELEASING.md); never `tag` or push without being asked
eval "docker build $(pnpm exec sovereign-manifest docker-args) -t ledger:ci ."   # the image, with its port and label from the manifest
```

A command a task adds is written here in that task's change, and `verify` means all of it that applies.

## Layout

`DESIGN.md` §5.1 is where things go as the app is built; this is what is here now.

| Path                           | What                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`                         | Routes and layouts (App Router): the signed-in area `(app)/` with a placeholder for each place, `/api/health`, and the pages for a missing or failed route                                                                                                                                                                                                                      |
| `src/config/`                  | Settings: `env.ts` is the only place `process.env` is read, `index.ts` checks them, `current.ts` keeps them, `edge.ts` is what the proxy reads                                                                                                                                                                                                                                  |
| `src/db/`                      | The database layer (`DESIGN.md` §18): `config.ts` (which form), `client.ts`, `provision.ts`, `migrate.ts`, `boot.ts`, `exec.ts`, `schema/{sqlite,postgres}/` with the column vocabulary in `columns.ts`                                                                                                                                                                         |
| `src/jobs/`                    | Background work in the web process: `runner.ts`, `claim.ts` (a conditional update that says who won), `index.ts` (`jobsFor`, the list of jobs, which each task that has one adds to)                                                                                                                                                                                            |
| `src/ledger/`                  | Books and currencies, and the one path transactions are written through: `validate.ts` (pure), `transactions.ts` (create, update, delete), `balances.ts`, `invariants.ts`, `testing.ts` (rows for tests)                                                                                                                                                                        |
| `src/transactions/`            | The transactions list: `filter.ts` (the address, pure), `present.ts` (a row, pure), `FilterBar`, `EntriesList`                                                                                                                                                                                                                                                                  |
| `src/jars/`                    | Saving jars, earmarks inside an account: `jars.ts` (make, earmark, release, archive, move; the rule in the statement), `saving.ts` (the Saving group, pure), `contributions.ts` and `job.ts` (the monthly contribution), `spend.ts` (an expense paid from a jar), `notes.ts` (Overview's), `JarsSection`                                                                        |
| `src/recurring/`               | Recurring entries: `rule.ts` (the repeat rule, the next occurrence and the monthly equivalent, pure), `recurring.ts` (make, change, end and post), `job.ts` (`post-recurring`), `bills.ts` (a subcategory budgeted by its bills), `loan.ts`, `loan-entry.ts` and `loan-split.ts` (a loan's instalments, split by days), `present.ts` (pure), `RecurringManager`, `UpcomingList` |
| `src/overview/`                | Overview: `overview.ts` (this month, the closest rows and the checklist, pure, over the other screens' figures), `OverviewScreen`, `SetupChecklist`                                                                                                                                                                                                                             |
| `src/setup/`                   | The setup wizard: `setup.ts` (each step, safe to repeat), `locale.ts` (pure), `SetupWizard`                                                                                                                                                                                                                                                                                     |
| `src/payees/`                  | The payees page: `PayeesManager` (rename, archive, merge)                                                                                                                                                                                                                                                                                                                       |
| `src/entries/`                 | The add dialog: `EntryProvider` (the one form, mounted in the layout), `EntrySurface` (Dialog or Drawer), `compose.ts` (form to lines, pure), `month.ts`                                                                                                                                                                                                                        |
| `src/budget/`                  | Categories and subcategories (`categories.ts`, the page's `CategoriesManager`), and budgeted amounts with their history (`amounts.ts`, `budget-for.ts` pure)                                                                                                                                                                                                                    |
| `src/accounts/`                | The Accounts screens: `overview.ts` (groups and net worth, pure), `AccountsScreen`, `AccountDetail`, the add dialog and the account's actions                                                                                                                                                                                                                                   |
| `src/fx/`                      | Exchange rates: `frankfurter.ts` (the one request, and the answer read as hostile input), `rates.ts` (`fetchRates`, `rateOn`), `job.ts` (`fetch-rates`), `testing/` (a fake Frankfurter)                                                                                                                                                                                        |
| `src/security/`, `proxy.ts`    | The nonce policy and the headers every response has; the proxy keeps the Edge discipline (no Node built-ins, no database)                                                                                                                                                                                                                                                       |
| `src/ui/`, `src/theme/`        | `AppShell` (header, sidebar of five places, the phone's footer), `nav.ts` (the one list of places), the CSS token check; `data-theme` is set before first paint                                                                                                                                                                                                                 |
| `src/crypto/`                  | The instance key and envelope encryption, copied from Tusk and used by nothing yet (no credential is kept)                                                                                                                                                                                                                                                                      |
| `e2e/`, `playwright.config.ts` | Browser tests: the built app in Chromium and WebKit, on the database form the environment names                                                                                                                                                                                                                                                                                 |
| `migrations/`                  | The generated SQL, `sqlite/`, `postgres/` and `auth/` (better-auth's, per dialect), committed and reviewed. Never written by hand                                                                                                                                                                                                                                               |
| `src/account/`                 | Settings: the sections (profile, security, preferences, the book, currencies, budget, notifications, data)                                                                                                                                                                                                                                                                      |
| `src/notifications/`           | What Ledger tells people on its own: `channels.ts` (core's bell and email, SMTP, the activity logger; none throws, one failing leaves the others), `marks.ts` (a notice claimed once per book, kind and day or month), `job.ts` (the hourly `notify`), `recap.ts` (the monthly recap, pure over the month's report), `server.ts` (the channels the settings allow)              |
| `src/sovereign/`               | A person's deletion (`people.ts`, `delete-account.ts`), and what Sovereign tells the app: `http.ts` (the two notices' HTTP rules), `verifiers.ts` (the SDK's, the one file that imports it), `identity.ts`, `server.ts`                                                                                                                                                         |
| `src/sw/`, `src/pwa/`          | The service worker (a string, served at `/sw.js`: the build's files and icons only, never a page) and its registration; the manifest is `app/manifest.ts`                                                                                                                                                                                                                       |
| `src/portability/`             | The book in one file: `format.ts` (`TABLES`, the one list of what is in it and what points at what, and the export), `validate.ts` (the file read whole, pure), `import.ts`                                                                                                                                                                                                     |
| `src/reports/`                 | Reports: `month.ts` (a month's figures, pure over the screens' own, and the list of months), `ReportsScreen`                                                                                                                                                                                                                                                                    |
| `src/seed/`                    | The development seed: `seed.ts` (`seedBook`, `clearBook`), `local.ts` (which databases it may write to, pure); run by `scripts/seed.ts`                                                                                                                                                                                                                                         |
| `scripts/`                     | The CI classifier, `db-generate.mjs`, `dev-db.mjs`, `seed.ts` (with `lib/ts-resolve.mjs`), `boot-check.mjs`, `serve-standalone.mjs`, `e2e-shard.mjs`, `deploy-check.sh`, `release.sh` with `lib/release.sh` and `release/ledger.sh` (and `test-release.sh`)                                                                                                                     |
| `sovereign.manifest.json`      | What an instance reads to host the app, held to its schema and to the code it names by `src/sovereign-manifest.test.ts`                                                                                                                                                                                                                                                         |
| `Dockerfile`, `deploy/`        | One image on Debian (libSQL has no musl build), not root, on the manifest's port; the Compose setups for sqld, a file and PostgreSQL                                                                                                                                                                                                                                            |
| `.github/workflows/`           | `ci.yml` and `publish.yml` (a `vX.Y.Z` tag publishes the image to `ghcr.io`, with provenance)                                                                                                                                                                                                                                                                                   |

## Not in place yet

Each is a task in `ROADMAP.md`, not a thing to assume exists: the charts of the reports (8.4). Add it in its own branch, and move the line out of this section when it lands.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
