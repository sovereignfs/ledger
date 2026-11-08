# Epic 2: Accounts and sign-in

## Status

⏳ In progress: 4 of 6 tasks are done.

## Overview

Signing in, locally and through a Sovereign core, from one image; core's two notices; deleting everything of a person. Copied from Tusk's
`src/auth/` and `src/sovereign/`, renamed and trimmed (`DESIGN.md` §5.1).

## Related

[`DESIGN.md`](../../DESIGN.md) §13, §15.1, §17 · Tusk's `DESIGN.md` §6, §22 · `contracts/app-manifest.md` §4

## Tasks

#### ✅ 2.1 — Local sign-in

**Goal:** accounts of the app's own. **Design:** §13.1. **Depends on:** 1.5, 1.8.

**Technical:** better-auth 1.7 in the `ledger_auth` store with its own migrations; password, passkeys, authenticator app with backup codes, when
`LEDGER_AUTH_LOCAL` is `1` or `true` (404 otherwise); `LEDGER_AUTH_SIGNUP` (`closed`: the first account only); email verification and reset only with
SMTP; the `Auth` components; `getSession`, `requireAccount`. Copied: Tusk's `src/auth/`, `src/mail/`, `src/limits/`.

**Accepts when:** the first account can register and the second is refused with sign-up closed; sign-in works on all three databases over real
requests; the pages answer 404 with local sign-in off.

**Done as:** better-auth 1.7 on the auth store, copied from Tusk (`src/auth/`, `src/mail/`, `src/limits/`, the four pages, `/api/auth`) and trimmed to local sign-in: the passkey and authenticator-app plugins, email verification and reset only with SMTP, sign-up `closed` unless said open (enforced in the user-create hook, so it holds for every way an account is made), rate limits in the database, and sessions with a ten-minute fresh window kept for a later use. Sovereign sign-in is left out here and belongs to 2.3; the sign-in form still carries its button, switched off (`sovereign={false}`). `/api/auth` and the four pages answer 404 with `LEDGER_AUTH_LOCAL` off, by the proxy. The signed-in layout now requires a session, so a visitor is sent to `/sign-in` (`/` becomes the landing page in 2.2), and the avatar menu has Sign out (Settings joins in 2.6). `src/db/test-store.ts` is the shared migrated store for data-layer tests. Run here: 278 tests on a SQLite file and on sqld, 277 on PostgreSQL; 26 browser tests in Chromium and WebKit on a file, and the smoke and auth specs on sqld and PostgreSQL. `LEDGER_CORE_*` are accepted and checked as a group but do nothing yet.

#### ✅ 2.2 — Landing page and the address `/`

**Goal:** a visitor sees what Ledger is; a signed-in person sees Overview. **Design:** §14.3. **Depends on:** 2.1.

**Technical:** a static landing page from typed content with no client code; `proxy.ts` serves the signed-in area at `/` for a request with a session
cookie, as Tusk's.

**Accepts when:** `/` shows the landing page signed out and Overview (or setup) signed in, with no redirect loop.

**Done as:** `src/landing/` (the page, its CSS, typed content and the test that holds the content to what is built) copied from Tusk and written for Ledger, and `app/page.tsx` as the landing page for a visitor, with sign-in and, where the server would take it, sign-up. The proxy shows Overview at `/` for a request with a session cookie by rewriting to `/home`, so the address stays `/`, and sends `/home` itself back to `/` (a mark on the request stops a loop). Only the cookie's presence is looked at; a forged one reaches a page that checks the session and sends it to sign in. The landing says only what is so today (an account of one's own, sign-in, phone and desktop), and its test keeps the words of what is not built out until it is. 32 browser tests (Chromium and WebKit), including the landing, Overview at the same address, and a phone's width.

#### 📋 2.3 — Sign-in through core

**Goal:** a Sovereign core as a way in. **Design:** §13.1. **Depends on:** 2.1.

**Technical:** `genericOAuth` with PKCE S256 when `LEDGER_CORE_*` are all set; redirect `/api/auth/callback/sovereign`; scopes `openid profile email`;
sign-up `open` when core is the only way; no linking by email, linking from a signed-in session only; the fake Sovereign copied for tests.

**Accepts when:** sign-in through the fake Sovereign works; a core login whose email matches a local account is refused until linked from a session;
a partial `LEDGER_CORE_*` stops start-up.

#### 📋 2.4 — Core's notices

**Goal:** back-channel logout and account deleted. **Design:** §13.2. **Depends on:** 2.3, 2.5.

**Technical:** `/api/sovereign/backchannel-logout` and `/api/sovereign/account-deleted`, verified by `@sovereignfs/sdk` (`verifyLogoutToken`,
`verifyAccountDeletedToken`), `notice_seen` for replays, a bounded form, a rate limit, 404 without core. Account deleted runs `deletePerson` and
answers `200` only once done. Copied: Tusk's `src/sovereign/http.ts`, `verifiers.ts`, `identity.ts`.

**Accepts when:** against `createFakeCore`, a logout notice ends every session of the person, an account-deleted notice leaves nothing of them, and a
replayed `jti` is refused after a restart.

#### ✅ 2.5 — Deleting a person

**Goal:** one routine that deletes everything of an account. **Design:** §17. **Depends on:** 3.1.

**Technical:** `People.deletePerson` in `src/sovereign/people.ts`: books where they are the only member with every row by `book_id`, memberships,
marks, better-auth's rows, the `sub` link last; safe to run twice. `/api/account/delete` after the password or a fresh session. The test seeds one row
of every table and fails for a table nobody decided about.

**Accepts when:** after deletion no table holds a row of the person, a second person's book is untouched, and a second run succeeds.

**Done as:** `src/sovereign/people.ts`: `deletePerson`, one routine in a fixed order and safe to run again. A book of which the person is the only member is deleted in one transaction with every row of it by `book_id` (`BOOK_TABLES` in `src/ledger/tables.ts`, empty until a task makes such a table); whether they are alone is decided in the statement that deletes the book, not by a look beforehand. With another member (phase 2) only the membership goes. Then the rate counters, and the sign-in store (sessions, sign-ins, second factors, passkeys, verifications, and the account last). `people.test.ts` asks the schema for its tables and fails for one that is in none of its lists (seen failing with `rate_bucket` taken out of one), then seeds both accounts and finds nothing of the first and everything of the second, twice. `/api/account/delete` (copied from Tusk and trimmed): a preview, and a POST that asks for the password, counted, or for a session made in the last ten minutes for an account with none (core sign-in, 2.3). `src/access/body.ts` reads a body capped as it arrives. Run here on a file, sqld and PostgreSQL (323, 323 and 322 tests). The Settings section that offers it is 2.6.

#### ✅ 2.6 — Settings

**Goal:** Settings as a dialog over the page and as a page. **Design:** §15.1. **Depends on:** 2.1, 1.8.

**Technical:** Tusk's intercepting-route dialog and `/account` page, with the account sections (sign-in methods, passkeys, two-factor, linking core)
and a Data section holding delete account. The book's sections arrive with 9.3.

**Accepts when:** Settings opens from the avatar menu on every page and at `/account`, and each account section works on all three databases.

**Done as:** Settings copied from Tusk and trimmed to what Ledger has: `src/account/` (the shell, the dialog, `query.ts`, Profile, Security (password, authenticator app, passkeys and the list of devices), Preferences (the theme, kept on the device) and Data, which holds deleting the account with a preview that names the budget that would go), the page at `/account`, and the same content as a dialog over the page it was opened from by an intercepting route in the layout's `modal` slot. The avatar menu gains Settings. Sovereign's link and unlink panel, the notifications and activity sections, export, import and backup are left out; the book's own sections join in 9.3. 10 browser tests added (Chromium and WebKit): the dialog and its way back from three places, the page and a named section, the sections, the theme surviving a reload, and a wrong password deleting nothing; the Settings and smoke specs also pass on sqld and PostgreSQL. 328 unit tests.
