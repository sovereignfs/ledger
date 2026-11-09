# Epic 12: Release

## Status

⏳ In progress: 3 of 5 tasks are done; the release (12.4) and hosting (12.5) are the owner's to do.

## Overview

What makes phase 1 releasable and hosted.

## Related

[`DESIGN.md`](../../DESIGN.md) §19 · Tusk's `RELEASING.md`

## Tasks

#### ✅ 12.1 — Development seed

**Goal:** a book worth looking at. **Design:** §19 Testing. **Depends on:** 6.5, 7.2.

**Technical:** `pnpm seed [--reset|--remove]`, refusing a non-local database: a year deep, two currencies, every account type, splits, transfers, a
loan, jars, recurring entries of both modes, reviewed and unreviewed months, a missing rate. Grows as later tasks land.

**Accepts when:** a seeded book opens every screen with realistic data on all three databases.

**Done as:** **`pnpm seed [--reset | --remove] [--email you@example.com]`** (`scripts/seed.ts`), which fills the book of an account that has signed in (the oldest, or the one named)
and **refuses a database that is not on this machine** (`src/seed/local.ts`, pure and strict: a file, or `localhost`, `127.0.0.1`, `::1` or `*.localhost`; a service named
`sqld`, an address on a network, or a name that merely contains `localhost` is not local, and a URL that cannot be read is not). It does not make the account: it says to sign
up first (a password is not the seed's to choose), and without `--reset` it leaves a book that has accounts alone; `--remove` only empties it. **It adds no dependency:**
the app's own TypeScript runs under Node's `--experimental-transform-types` with a small resolver (`scripts/lib/ts-resolve.mjs`) that finds the files the source imports
without an extension, and the settings are read as the server reads them, from the environment and `.env.local` (`pnpm dev` makes it). `src/seed/seed.ts` is a function
(`seedBook`) and `clearBook`, so that it is tested: **a year deep (13 months), 11 accounts of every kind in USD, EUR and CHF, about 260 entries**, made through the same code the screens use
and not by writing rows: a rent, a salary, an internet bill and a subscription that post themselves, a yearly insurance that **budgets its subcategory**, an electricity bill that **asks
first** (a year of them confirmed with what each came to, and this month's due today, so Upcoming has something in it), a **car loan paying itself down** with its Loans category,
**two jars** with a contribution every month and a flight paid from one, splits, a card paid off, savings, a refund, a transfer between currencies with its two amounts, money lent to a
person and part paid back, side work, revaluations of an investment and a property, a reconciled account and a short wallet (an adjustment), a month-by-month budget with history, a
euro rate for each month and **no rate for the Swiss franc**, which is the missing rate said on Accounts and Overview. Random amounts come from a seeded generator, so the same day
makes the same book. 6 tests on all three databases (the invariants hold over the whole book, **every screen's own loader reads it**, what is listed above is there, the other
person's book is untouched, a book with accounts is refused, `clearBook` and a second seed make the same book) and 2 pure (what is local); and the built server was seeded and signed
into, and every page answered 200 with the data. **Left out, and said:** _reviewed and unreviewed months_, which wait for the month-end review (8.5); the seed grows with the tasks after it. **Grown since:** `src/seed/states.ts` and `docs/seed.md` add a state for every feature built by Milestone G (reviewed months, insights, archived and merged things, overdue and skipped and ended bills, jars that reached their target, never fit or are archived, yen and dinars with rates, a person you owe, other scripts and markup as names, a raise from next month); `seed.test.ts` finds each, and the export and import round trip runs over the richer book.

#### ✅ 12.2 — Security review

**Goal:** phase 1 reviewed before it is released. **Design:** §19 Security. **Depends on:** 11.2, 8.6.

**Technical:** `docs/security-review-phase-1.md`, as Tusk's: access (§5.2) route by route, deletion (§17), the notices, logs, the CSP, the jobs'
claims; each finding fixed or recorded.

**Accepts when:** the review is written and every finding is fixed or has an owner's decision.

**Done as:** [`docs/security-review-phase-1.md`](../security-review-phase-1.md), in Tusk's manner: access route by route, what is cached, where sign-in may send a person, sign-in itself, import as
untrusted input, the notices, deletion, the logs, the notices Ledger sends and the jobs' claims, the policy, credentials and dependencies, each with the test that holds it. **Two findings, both
fixed:** every read of a book's API was answered with **no `Cache-Control`** (now `no-store` on every answer of `bookRoute`, held for every address of the table of routes by `e2e/headers.spec.ts`, which
failed first on the API's reads), and **export and import had no limit** (30 and 10 an hour for a person, `429` with `Retry-After`). It also added `validate.test.ts` (names that mean something to
JavaScript are refused as table and column names) and changed the recap's text in Settings, which now says it names the categories. `pnpm audit --prod` finds nothing; two moderate in tools that do not ship are
recorded. **What is left is listed in the document:** a review by someone else first of all.

#### ✅ 12.3 — Documents

**Goal:** a README a self-hoster can follow. **Depends on:** 1.10.

**Technical:** `README.md` (what it is, running it in each form, every setting, hosting on an instance, the operator's backups), `deploy/README.md`,
`RELEASING.md` and `scripts/release.sh` copied from Tusk.

**Accepts when:** someone following the README alone runs the image on a file database and signs in.

**Done as:** `README.md` (what it does, the one `docker run` on a file and signing in, every setting in a table with `.env.example` beside it, exchange rates, hosting on an instance with the core floor, what is the
operator's backup and what is the person's export), `deploy/README.md` as it was (the three setups, start-up, your own PostgreSQL, keys, backups, updating, the checks), and **copied from Tusk with the names
changed:** `RELEASING.md`, `scripts/release.sh`, `scripts/lib/release.sh` and `scripts/release/ledger.sh` (`check`, `prepare`, `propose`, `tag`, `verify`; the checks that a released migration is not edited and that a
patch release has no migration), and `scripts/test-release.sh` (71 checks against throwaway repositories and a stand-in for `gh`, which pass). The changelog gained the `[Unreleased]` link the script
moves, and CI runs the script's tests and `shellcheck` over the three directories when `scripts/` changes. **Not tried:** following the README from a machine with no checkout, which needs the published image.

#### 📋 12.4 — Release 0.1.0

**Goal:** the first published image. **Depends on:** 12.2, 12.3.

**Technical:** `scripts/release.sh check | prepare | propose | tag | verify 0.1.0`; the package made public the first time.

**Accepts when:** `ghcr.io/sovereignfs/ledger:0.1.0` exists for amd64 and arm64, with provenance, and boots.

#### 📋 12.5 — Hosting on an instance

**Goal:** Ledger in the live suite. **Depends on:** 12.4.

**Technical:** in `openfs-suite`: `./sv app add ledger --image ghcr.io/sovereignfs/ledger:0.1.0`, the three app scopes granted, `./sv push &&
./sv deploy`; core's table of ports in `sovereign`'s `building-an-app.md` §2 gains 3003.

**Accepts when:** a person opens Ledger from the launcher, signs in through core, completes setup and receives a recap in the bell.
