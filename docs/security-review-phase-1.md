# Ledger, security review of phase 1

The review of task 12.2 ([`docs/epics/release.md`](epics/release.md)): what [`DESIGN.md`](../DESIGN.md) §5.2, §7, §13, §16, §17 and §19 promise and what the rules of
[`AGENTS.md`](../AGENTS.md) say, tried against the built app and not the code alone, what was found, what was done, and what was left. It is a record of one review at one
time (9 November 2026), in the manner of Tusk's ([`sovereignfs/tusk`, `docs/security-review-phase-1.md`](https://github.com/sovereignfs/tusk)); the promises themselves stay in
the design. Each protection named below is a test, and each test marked "seen to fail" was run against the code with the protection switched off.

**Who did it:** one reviewer, who wrote the code, with the tests and the app. That is a limit, and it is the first thing under _Left_. Nothing here is an audit.

## Summary

Two things were found and fixed. **Every read of a book's own API (`/api/accounts`, `/api/budget`, `/api/payees` and the rest) was answered with no `Cache-Control`**, so that a
shared cache between the server and a browser was free to keep a person's accounts, entries and budget (finding 1); and **an export and an import could be asked for without
limit**, each reading or parsing a whole book (finding 2). Nothing was found open in access, deletion, sign-in, the notices, the logs or the jobs' claims. What had been left
unchecked as a whole is now a test (findings 1, 2 and 7), and what is left is listed.

## What was checked, and what was found

### 1. What is a person's was not marked as uncacheable

Pages were: Next.js answers a page that reads the session `no-store`. **The API was not**: a `GET` to `/api/accounts` came back `200` with no `Cache-Control`, and so did the other
reads of a book (`entry-options`, `payees`, `recurring`, `upcoming`, `jars`, `book`, `reviews`, `budget`, `income`, `categories`). A browser may keep such an answer by its own
heuristics, and a shared cache between it and the server, which an operator puts there on purpose or by accident, may keep it for everyone. `DESIGN.md` §14.6 says no page with money
on it is ever cached; the same had to be true of its data. **Fixed** at the one place every such route passes through: `bookRoute` (`src/access/route.ts`) sets `no-store` on
every answer it gives, a refusal included, and leaves alone an answer that already says what it may be kept as (the download does). A redirect, whose headers cannot be changed, is
copied with its own. **Tested:** `route.test.ts` for a success, a `401`, a `403`, a redirect and one that already has a header (seen to fail with the header left off); and
`e2e/headers.spec.ts`, which walks the table of routes (`src/access/routes.ts`) and asks every page and every route of a book that has no parameter, as a signed-in person, and
fails on any success that is not `no-store`: it failed first on the API's reads, and holds for pages and routes now, so that a new route is held to it without being added to the test.

### 2. Export and import had no limit

Both need a session and a book, but each does the whole of a book's work: an export reads every table, an import parses up to 64 MB and validates it before it can say the book is
not empty. A signed-in person, or a script holding their cookie, could ask for either in a loop. **Fixed:** at most 30 exports and 10 imports an hour for one person, counted in the
database as the other limits are (`src/limits/rate.ts`), answered `429` with a `Retry-After` and, for an import, before the file is read. Tested for the one who asked and not the
other, on all three databases (seen to fail with the limit shared between people and with the import's limit removed).

### 3. Access: every route, as the second person

`src/access/routes.ts` lists every page and route with who may use it and is held to `app/` by `routes.test.ts` in both directions: a route that is not in it fails, and so does an
entry whose route is gone. A route the table says is for a book must be wrapped in `bookRoute` (which finds the session first, then checks `Origin` on a write, then finds the
book) and a page must ask `requireBook()`; the test fails on one that does not. **The permission is in the statement** (`inBook`, `src/access/book.ts`): `book.test.ts` shows it is a
condition of the same query, not a check before one, and that a value is bound and never joined. Every route module under `src/access/` has a test that calls it as a second person
(`accounts`, `book`, `budget`, `categories`, `income`, `jars`, `payees`, `portability`, `recurring`, `reviews`, `setup` and `transactions` `-api.test.ts`), and a refusal reads as not
found. The review listed the 39 route files and the module each one calls to check none was missing a test; none was. The account id is the session's: `route.test.ts` sends another
person's id in the query, the body and a header, and the handler is given the cookies'. **No finding.**

### 4. What is a person's is never cached by the app, and the worker keeps only the build

Pages and routes: finding 1. The service worker (`src/sw/source.ts`) is evaluated by its test with a cache and a network the test controls, after everything a signed-in person does:
it keeps only the build's files, the icons and the manifest, never a page, never an answer from `/api`, and answers a page with one of its own when there is no network, holding
nothing of a person and no script. A server that is not a build serves a worker that keeps nothing and removes itself. **No finding** beyond 1.

### 5. Where a sign-in route may send a person

Every route of the sign-in library that takes a return address (password sign-in and sign-up, a reset, a verification, the start of Sovereign sign-in and linking) is given another
site's address, a protocol-relative one, a backslash and `javascript:` by `src/auth/redirects.test.ts`, and none sends anyone anywhere but here. **No finding.**

### 6. Sign-in

Read in `src/auth/auth.ts` against the design: sessions are cookies with the app's prefix, `Secure` over https, with better-auth's origin check **switched on explicitly** (it is off
under `NODE_ENV=test`); sign-in, sign-up, reset and the second step are rate-limited in the database; a Sovereign identity is its `sub` and is never matched to an account by an
address (`disableImplicitLinking`), linking is from a signed-in session fresh within ten minutes and only for the account's own address, the last way in is never removed, and the
core's ID token is verified against its keys (`requireIdTokenVerification`, PKCE); a person who came in through Sovereign alone has no password route to attack; sign-up is closed
after the first account unless the operator opens it, in one hook that holds for every way an account can come to be. Tested in `auth.test.ts`, `two-factor.test.ts`,
`sovereign.test.ts`, `mail.test.ts` and the browser tests of `e2e/sovereign.spec.ts`, which run against two instances of the SDK's own fake core. **No finding.**

### 7. Import is untrusted input

A file is read by one validator (`src/portability/validate.ts`), whole, before anything is written: bounded (64 MB, a cell of 100,000 characters, ids of 64), every table and every
column looked up in a list the app owns, every reference to a row that is in the file, and refused with sentences if any part is wrong, **changing nothing**; it goes in one
transaction into an empty book, it always creates and never replaces, and ids are made again. The review added the test that was missing, `validate.test.ts`: a table named
`__proto__`, `constructor` or `toString`, a column with such a name, a row with every column and one more, and a row that is not an object are each refused, and `Object.prototype` is
untouched (seen to fail with the table check and with the column check removed). **No finding** beyond the missing test.

### 8. Notices from the instance

Core's two notices (`/api/sovereign/backchannel-logout` and `/api/sovereign/account-deleted`) are verified by the SDK (type, signature against core's keys, issuer, audience, age,
event, `jti`), once each (a replay is refused, through the database's rate table), from a bounded form read no further than its limit, rate-limited before the token is read,
`404` where no core is set, `no-store` whether they succeed or not; a deletion answers `200` only once it is done and `500` otherwise so that core sends it again, and a logout
notice is not taken for a deletion (`http.test.ts`, against the SDK's fake core). **No finding.**

### 9. Deleting a person

`People.deletePerson` is the one routine, safe to run twice. `people.test.ts` asks the schema for its tables and **fails on any table that is in none of its three lists** (goes with
the person, is a book's, is not about a person), so a table cannot be added without deciding what becomes of it; it then seeds one row of every table of a book for two people, runs
the routine twice, and finds nothing of the first and everything of the second. The review added `book_job_mark` (the notices' claims) to that seeding in the task that made it. An account that
shares a book is taken out of it and the book is left to the others. **No finding.**

### 10. Logs

Every `console.*` of the app was listed, and every `log` a module is given: the database in use (its form and host, no credential), the jobs by name with a count or a kind of failure
(`contribute-jars: 2 contributions did not fit`, `post-recurring: 1 recurring entry could not be posted`), the notices' channels by name, kind and outcome, and start-up problems that
name a setting and never its value. **No amount, name, payee, note, address or `sub` is in any**, and `channels.test.ts` plants a title, an address and a `sub` and fails if a line
holds them; `job.test.ts` and `recap.test.ts` check the same of the recap. **No finding.**

### 11. The notices Ledger sends, and the jobs' claims

A notice (the bills waiting, a newly firing insight, the recap) is **claimed first** in `book_job_mark` by one insert whose condition is the book's permission and whose key is unique per
book, kind and day or month, and only then sent, so two runs and two processes send it once and a send whose answer was lost is not repeated (tested at once, by two callers, on all
three databases; seen to fail with a claim that always succeeds and one without the permission). With no channel nothing is claimed. A core that does not serve a call, or refuses the app,
rests that channel for six hours; **one channel failing leaves the others**. A recurring posting is unique on `(recurring_id, occurrence_date)` and a jar's contribution on
`(jar_id, month)`, each with the table's own key as the backstop, so no path can write one twice. The exchange-rate fetch sends only currency codes. **No finding.**

### 12. Content security policy, headers, and what text can do

`src/security/csp.ts` makes a nonce for each request: no inline script, handler or `eval` in production, nothing third-party, no framing, no plugin, forms only here, `base` only here,
HSTS over https, `nosniff` and a strict referrer policy; `proxy.test.ts` checks that a page is sent with a policy that carries the nonce it is given. Nothing writes what people wrote as HTML (a payee, a
note, a category name, an insight is rendered as text), and the browser tests fail on any blocked request. The recap and the notices put names a person wrote into a bell and an email
**to that person**, and Settings, Notifications says that the recap names its categories before it is turned on. **No finding.**

### 13. Credentials

Ledger keeps none in phase 1: it signs people in and calls core and Frankfurter, and holds no token of anyone's, and `src/crypto/` (envelope encryption under `LEDGER_ENCRYPTION_KEY`) is
there so that the first release that keeps one is not a change of setting. A secret appears in no error, log, URL or the browser, and no secret has a default. Nothing was reviewed here
because nothing is kept.

### 14. Dependencies

`pnpm audit --prod`: **no known vulnerability** in what ships. `pnpm audit` over everything finds two moderate, both in tools that do not ship: `esbuild` (through the migration
generator) and `minimatch` (through the linter). **Recorded, not changed**: they are not in the image and move with those tools. Licences were chosen to be compatible with
AGPL-3.0-or-later when each dependency was added (`AGENTS.md`) and were **not re-audited in this review**.

## Left

- **A review by someone else.** This was done by the person who wrote it, and it is not a penetration test.
- **Rate limits are fixed windows** (up to twice the limit across an edge), by account for most routes and not by network address; the numbers are constants. Sign-in limits depend on a
  proxy that sets the client's address (`X-Forwarded-For`): behind one that does not, every visitor shares a limit. The deploy guide says to put a proxy with TLS in front; that is
  the operator's.
- **`/api/health` is public** and says the database's dialect; the deployment checks use it and it holds nothing secret.
- **Whoever runs the server can read every book**: the book is not sealed with a key of the person's own, and phase 1 does not claim it is.
- **An export is a plain file** holding the whole book; where a person keeps it is theirs to decide, and the documentation says so.
- **Open sign-up with no mail has to say an address is taken**, or a person cannot tell why it failed (with mail verification it says nothing). By design.
- **The accessibility pass with a screen reader and a real instance** are by hand and not done; the automated checks of the browser tests are.
- **Not reviewed, because it does not exist yet:** the charts of the reports (8.4).
