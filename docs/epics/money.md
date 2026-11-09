# Epic 3: Books and money

## Status

✅ Done: 4 of 4 tasks are done.

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

#### ✅ 3.2 — Money and currencies

**Goal:** amounts that are always right. **Design:** §9.1, §18.2. **Depends on:** 1.5.

**Technical:** `src/money/`: the ISO 4217 fiat table with decimals generated from ICU (`scripts/generate-currencies.ts`, adapted from the plugin's
idea), `parse`, `format` in a locale with the currency's decimals, add and split with no floating point, rounding half to even; `book_currency`; a
`MoneyInput` binding `CurrencyInput.decimals` to a currency, and a currency picker on `Combobox`.

**Accepts when:** ¥1,500 reads ¥1,500, 1.005 BHD keeps three decimals, splitting 100.00 three ways sums to 100.00, and a float never reaches a column
(a test feeds one and is refused).

**Done as:** `src/money/`: `currencies.ts` generated from ICU by `scripts/generate-currencies.ts` (160 ISO 4217 currencies, each with its own decimals, **fiat only**: BTC is not carried and the IMF's Special Drawing Right and the Sucre are left out); `amount.ts` (an amount is a safe integer or a `MoneyError`; exact sums that refuse a total too large to be exact; `divideRoundHalfEven` on bigints, tested at the halves in both directions; `splitMinor`, whose parts always add up, with a randomised property over 2,000 runs); `text.ts` (`formatMoney` and `parseAmount` go through decimal text and integers, never a float). `parseAmount` refuses more decimals than the currency has and refuses a grouping mark anywhere but where it groups, so `3,40` typed in English is not 340. `book_currency` (migration `0002`, and listed in `BOOK_TABLES` so that deleting a book deletes it) with `addCurrency` and `listCurrencies`, whose statements carry `inBook`: a code that is not a currency is refused, another person's book reads as one that is not there, and four at once add one row. `MoneyInput` and `CurrencyPicker` in `src/ui/`, with a guard test that only `MoneyInput` may use the design system's `CurrencyInput`. ¥1,500 reads ¥1,500, 1.005 BHD keeps its three, 100.00 split three ways is 33.34, 33.33 and 33.33, and a float is refused by `assertMinor` before it can reach a column (tested against the vocabulary table on each database). 365 unit tests on a file and sqld, 364 on PostgreSQL.

#### ✅ 3.3 — Exchange rates

**Goal:** a rate for every currency in use, every day. **Design:** §9.2. **Depends on:** 1.6, 3.2.

**Technical:** `fx_rate`; the `fetch-rates` job: the distinct codes in `book_currency` and `money_account`, minus USD and codes Frankfurter does not
list, one request, one row per currency and day (`as_of` from the answer), idempotent on the key; a timeout; `LEDGER_FX=off`, `LEDGER_FX_URL`; a fake
Frankfurter for tests. `rateOn(currency, date)`: the latest row not after the date.

**Accepts when:** two runs on one day store one row per currency; a fresh instance makes no request; an uncovered code does not fail the request; a
date before the first rate has no rate.

**Done as:** `src/fx/`. `fx_rate` (migration `0003_fx_rate`, both dialects; `(currency, as_of)` is the key, no `book_id`, and it is listed as not a person's in `people.test.ts` so that deleting a person leaves it). `frankfurter.ts` makes the one request, `GET /v1/latest?base=USD`, and reads the answer as hostile input (a mirror may be behind `LEDGER_FX_URL`): the base must be USD, the date a real day not after tomorrow, a currency one of ours, a rate plain digits above zero; **a rate is kept as the JSON number's source text** (`JSON.parse`'s `context.source`), so a digit is never lost to a double, which a test with 18 decimals shows; no redirect is followed, the body is capped at 256 KiB, the time limit is ten seconds and it ends when the process stops; an error is a kind (`FxError status`) and never an address or a body. `rates.ts`: `currenciesInUse` (the distinct codes of `book_currency`, no USD), `storeRates` (one transaction, `ON CONFLICT DO NOTHING`, the first row of a day is kept), `fetchRates` (no code in use, no request; the transaction is after the request, not around it) and `rateOn(currency, date)` (the latest row not after the date, none before the first, USD always `1`, a bad code or date throws). `job.ts` is `fetch-rates`: at start and every three hours, with no claim, since it is idempotent by its key. `jobsFor(config)` in `src/jobs/index.ts` replaces the empty `jobs` list, and leaves the job out with `LEDGER_FX=off`; `LEDGER_FX` and `LEDGER_FX_URL` were declared in 1.4. A fake Frankfurter for tests is in `src/fx/testing/`. Changes from the task text and `DESIGN.md` §9.2, which says so: **the request carries no list of codes** (the answer is filtered to the currencies in use), since that is how "one request" and "codes Frankfurter does not list" both hold without a second request for its list, and not even the codes a person uses are sent; and the job is every three hours rather than daily, so that a new currency has a rate within hours. Left for 4.1: `money_account` does not exist yet; its currency reaches `book_currency` (and so the fetch) because §9.1 has an account's currency added there. Left for 3.4: conversion, and loading rates once per page.

#### ✅ 3.4 — Conversion

**Goal:** any amount in any currency, at its own date. **Design:** §9.3. **Depends on:** 3.3.

**Technical:** `convert(amount, from, to, date, rates)`, pure, through USD, exact decimal arithmetic, half-even to the target's minor unit; a total
type that carries "not included" amounts per currency; rates loaded once per page for a date range.

**Accepts when:** worked examples match by hand to the minor unit; a total with a missing rate reports what it left out and never counts it as zero.

**Done as:** `src/money/convert.ts`, pure. `convertMinor(amount, from, to, date, rates)` reads each rate as digits over a power of ten (`parseRate`, exact, no float) and does **one** bigint division, `a · nt · 10^(dt+sf) / (nf · 10^(df+st))`, rounded half to even by `divideRoundHalfEven`, so two rates never round twice and each currency keeps its own decimals; the same currency is returned as it is; no rate on either side is `undefined`, never zero; a bad code, a non-whole amount, a rate that is not exact text or a result past a safe integer throws a `MoneyError`. `convertedTotal(items, to, rates)` converts each amount at its **own date** and returns the sum, how many amounts are in it and `notIncluded`, one entry per currency left out with its count and its sum in that currency; `notIncludedLines` is `DESIGN.md` §9.3's sentence ("1 amount in USD not included"). `RateTable` holds the rates for a range of days, found by binary search for the latest row not after a date, and refuses a date outside its range rather than answer a "no rate" the database might not agree with. `loadRates(database, currencies, from, to)` in `src/fx/rates.ts` is the one statement that fills it (the rows of the range and, for each currency, the one in force at its start); the tests show it agrees with `rateOn` on every day of a range. Worked by hand in the tests: 100.00 USD is 90.00 EUR at 0.9; 50.00 EUR is 10 000 JPY at 0.8 and 160; 1.000 BHD at 0.376 is 2.66 USD; 1.00 USD at 154.5 is 154 JPY and 3.00 USD is 464 (halves to the even one, and symmetric below zero); 100.00 EUR to GBP at 0.85 and 0.75 is 88.24, rounded once. 85 tests across `src/money` and `src/fx`; each key test was seen to fail against the code it guards (half up, a missing rate as zero, the wrong currency's decimals, the first row for the last, the range's starting row dropped). The screens that show a converted total (4.1, 5.4, 8.1) use these and say what was left out; none exists yet.
