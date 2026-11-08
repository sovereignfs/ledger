# Epic 1: Foundation

## Status

📋 Planned.

## Overview

The repository that can hold Ledger as `DESIGN.md` designs it: a Next.js app that runs alone or hosted, on three forms of database. Nothing a person
would notice. **Tusk is the model throughout, and its infrastructure is copied** (`DESIGN.md` §5.1), renamed to `LEDGER_`, and trimmed of what
Ledger does not use (sync, workspaces, the cipher, backup). Each task says which files it copied.

## Related

[`DESIGN.md`](../../DESIGN.md) §5, §14.6, §18, §19 · Tusk's `docs/epics/foundation.md`

## Tasks

#### 📋 1.1 — Repository conventions

**Goal:** the files a repository of the suite is expected to have. **Design:** §19, `AGENTS.md`. **Depends on:** nothing.

**Technical:** `LICENSE` (AGPL-3.0-or-later), `CHANGELOG.md` with `[Unreleased]`, `CONTRIBUTING.md`, `README.md`, PR template, Dependabot,
`.editorconfig`, `.node-version`; `package.json` (`@sovereignfs/ledger`, `type: module`, engines `>=24.15 <25`, pnpm 11 with `minimumReleaseAge` and
`allowBuilds`); Next.js 16 (latest stable), React 19, TypeScript 6.0.x strict with `noUncheckedIndexedAccess`; `@sovereignfs/ui`, `sdk`, `config`,
`manifest` pinned exactly at Tusk's versions.

**Accepts when:** a clean checkout installs with `pnpm install --frozen-lockfile`, `pnpm typecheck` passes, and `git status` is clean after.

#### 📋 1.2 — Format, lint and test tooling

**Goal:** the checks every later task runs. **Design:** §19 Testing. **Depends on:** 1.1.

**Technical:** Prettier and ESLint as Tusk's (copied configs); Vitest with the design system inlined and files run one after another; scripts
`format`, `format:check`, `lint`, `typecheck` (`next typegen && tsc --noEmit`), `test`; one real test.

**Accepts when:** each check passes, and each is seen to fail on a planted fault.

#### 📋 1.3 — Continuous integration

**Goal:** CI that runs what a change can affect. **Design:** §19. **Depends on:** 1.2.

**Technical:** Tusk's `ci.yml` and its change classifier, copied; legs for format, lint, types, unit tests; the database legs join with 1.5, the image
with 1.10, the browser with 1.9. Skipped on drafts and `skip-ci`.

**Accepts when:** a PR runs only the legs its files affect, and a failing leg fails the PR.

#### 📋 1.4 — Configuration and start-up

**Goal:** settings declared once and checked before anything is served. **Design:** §13.1, §19 Deployment. **Depends on:** 1.2.

**Technical:** `@sovereignfs/config` with prefix `LEDGER`: `URL`, `AUTH_SECRET`, `AUTH_LOCAL`, `AUTH_SIGNUP`, `CORE_*`, `DB_*`, `SMTP_*`,
`ENCRYPTION_KEY(_PREVIOUS)`, `WORKER`, `FX`, `FX_URL`; `_FILE` forms for secrets; `instrumentation.ts` hands to `instrumentation-node.ts`, which checks
and stops on a wrong setting; `.env.example` held to the declarations by a test; `/api/health`. Copied: Tusk's `src/config/`, instrumentation.

**Accepts when:** a missing or malformed setting stops start-up with every problem named and no value printed; `.env.example` matches the code.

#### 📋 1.5 — The database layer

**Goal:** three forms, two dialects, migrations at start-up. **Design:** §18.1, §18.2. **Depends on:** 1.4.

**Technical:** copy Tusk's `src/db/` (config, clients, provision, migrate, boot with retries and `DB_CONNECT_TIMEOUT_MS`, `exec.ts`, the column
vocabulary, `test-support.ts` reading `LEDGER_TEST_*`); add a `money` column (64-bit minor units, checked safe on read) and a `month` column; the two
stores `ledger` and `ledger_auth`; `pnpm db:generate`, `pnpm db:dev`; the parity test; CI legs on sqld, a file and PostgreSQL.

**Accepts when:** an empty database of each form is provisioned and migrated at start-up, twice safely; CI fails if generating would write anything.

#### 📋 1.6 — The job runner

**Goal:** background work in the web process, safe across processes. **Design:** §5. **Depends on:** 1.5.

**Technical:** copy Tusk's `src/jobs/` (runner, `claim.ts`, `index.ts`) and `job_claim`; `LEDGER_WORKER=off`; stopped on SIGTERM.

**Accepts when:** a job's work is done once when two processes run it; SIGTERM stops the runner and the server cleanly.

#### 📋 1.7 — Security headers

**Goal:** the CSP and headers every response has. **Design:** §19 Security. **Depends on:** 1.4.

**Technical:** copy Tusk's `proxy.ts` and `src/security/` (nonce CSP, `connect-src 'self'`, no `'unsafe-inline'`, HSTS over https, Edge discipline).

**Accepts when:** every response, including errors and redirects, carries the policy; a test fails if `'unsafe-inline'` appears in `script-src`.

#### 📋 1.8 — Design system boundary and shell

**Goal:** `@sovereignfs/ui` wired in, with the app's shell. **Design:** §14.1, §14.2. **Depends on:** 1.2.

**Technical:** tokens and Hanken Grotesk served by the app; `src/theme/` sets `data-theme` before paint; `AppShell` with the sidebar (Overview,
Transactions, Budget, Accounts, Reports; Add pinned) and `MobileFooter` at a phone's width; the app's CSS check (only `--sv-*` colours); Ledger's mark
in `public/icons/`; not-found and error pages.

**Accepts when:** the shell renders in light and dark at desktop and phone widths, with no literal colour anywhere.

#### 📋 1.9 — Browser tests

**Goal:** Playwright on the built app. **Design:** §19 Testing. **Depends on:** 1.5.

**Technical:** Tusk's Playwright setup copied: Chromium and WebKit, the database form from the environment, shards in CI.

**Accepts when:** a smoke test opens the built app on each database form in CI.

#### 📋 1.10 — The image and deployment setups

**Goal:** one image, three Compose setups. **Design:** §19 Deployment. **Depends on:** 1.5, 1.6.

**Technical:** `sovereign.manifest.json` (§13.3) with `pnpm manifest:check` and a test holding it to the code; Tusk's Dockerfile (Debian, `USER node`,
`ARG PORT`, migrations beside the server, licences) built with `sovereign-manifest docker-args`; `deploy/` for sqld, a file and PostgreSQL;
`scripts/deploy-check.sh`; `publish.yml` on a `vX.Y.Z` tag.

**Accepts when:** `scripts/deploy-check.sh` boots every setup from nothing and as an instance would host it, answering `/api/health` with `200`.

#### 📋 1.11 — The PWA

**Goal:** installable, with a service worker that keeps the shell only. **Design:** §14.6. **Depends on:** 1.8.

**Technical:** copy Tusk's `src/sw/` and the web manifest; an allow-list of build files and icons; an offline page that says Ledger needs a
connection. No page with money on it is ever cached.

**Accepts when:** the app installs in Chromium; a test of the worker's source shows it caches nothing outside the allow-list.
