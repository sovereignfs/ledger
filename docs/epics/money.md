# Epic 3: Books and money

## Status

⏳ In progress: 1 of 4 tasks are done.

## Overview

The book every row belongs to, and the access rule built on it; money as minor units in every fiat currency; the daily rates and conversion at a
date. Everything after stands on these.

## Related

[`DESIGN.md`](../../DESIGN.md) §5.2, §5.3, §9, §18.3

## Tasks

#### ✅ 3.1 — Books and access

**Goal:** a book per person, and the permission in every statement. **Design:** §5.2, §5.3. **Depends on:** 2.1.

**Technical:** `book`, `book_member` (`owner`); a book made at first sign-in (base currency and time zone empty until setup); `bookRoute` (session,
`Origin` on a write, the person's book); a `inBook(bookId, accountId)` condition every query uses; `src/access/routes.ts` with `routes.test.ts`
holding it to `app/`; two real accounts for tests (`two-accounts.ts`, copied).

**Accepts when:** every route and action in the list is called as a second person and answers not found; a route missing from the list fails the
test.

**Done as:** `book` and `book_member` (migration `0001_books`, both dialects), and `src/ledger/books.ts`: `ensureBook` makes a person's book at their first request with an id derived from the account's (`uuid5`, copied from Tusk with Ledger's namespace), so two requests that find none make the same row and one makes it; seen with four at once. `src/access/`: `inBook`, the membership condition that every statement on a book's rows carries; `bookRoute` (session, `Origin` on a write, then the account and its book, never what a request names), `requireBook` for pages and server actions, `routes.ts` with `routes.test.ts` holding it to `app/` both ways (a route with no rule, a page that never asks, a handler that is not wrapped all fail, each seen to), and `two-accounts.ts`, two real accounts for later tests. The `book` kind replaces Tusk's `account`. Run here: 310 tests on a file and sqld, 309 on PostgreSQL; 13 browser tests. Left for the tasks that make rows: calling each route as the second person (there is none that reads a row yet; `book.test.ts` shows the statement-level answer, and a hostile account id is bound and matches nothing).

#### 📋 3.2 — Money and currencies

**Goal:** amounts that are always right. **Design:** §9.1, §18.2. **Depends on:** 1.5.

**Technical:** `src/money/`: the ISO 4217 fiat table with decimals generated from ICU (`scripts/generate-currencies.ts`, adapted from the plugin's
idea), `parse`, `format` in a locale with the currency's decimals, add and split with no floating point, rounding half to even; `book_currency`; a
`MoneyInput` binding `CurrencyInput.decimals` to a currency, and a currency picker on `Combobox`.

**Accepts when:** ¥1,500 reads ¥1,500, 1.005 BHD keeps three decimals, splitting 100.00 three ways sums to 100.00, and a float never reaches a column
(a test feeds one and is refused).

#### 📋 3.3 — Exchange rates

**Goal:** a rate for every currency in use, every day. **Design:** §9.2. **Depends on:** 1.6, 3.2.

**Technical:** `fx_rate`; the `fetch-rates` job: the distinct codes in `book_currency` and `money_account`, minus USD and codes Frankfurter does not
list, one request, one row per currency and day (`as_of` from the answer), idempotent on the key; a timeout; `LEDGER_FX=off`, `LEDGER_FX_URL`; a fake
Frankfurter for tests. `rateOn(currency, date)`: the latest row not after the date.

**Accepts when:** two runs on one day store one row per currency; a fresh instance makes no request; an uncovered code does not fail the request; a
date before the first rate has no rate.

#### 📋 3.4 — Conversion

**Goal:** any amount in any currency, at its own date. **Design:** §9.3. **Depends on:** 3.3.

**Technical:** `convert(amount, from, to, date, rates)`, pure, through USD, exact decimal arithmetic, half-even to the target's minor unit; a total
type that carries "not included" amounts per currency; rates loaded once per page for a date range.

**Accepts when:** worked examples match by hand to the minor unit; a total with a missing rate reports what it left out and never counts it as zero.
