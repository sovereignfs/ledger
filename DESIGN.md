# Ledger — design

**Status:** draft, written on 2026-11-08 from the legacy `sovereign-plugin-ledger` (manifest 0.18.0), Tusk's design and the owner's direction.
Nothing is built. Where this file and a contract Sovereign publishes disagree, the contract wins (`AGENTS.md`, Source of truth). §22 holds what is
still waiting on a decision, and §23 what has been decided and why.

[`ROADMAP.md`](ROADMAP.md) puts the work in order, and [`docs/epics/`](docs/epics/) holds each task's detail.

---

## 1. Purpose

Ledger is a person's own money, in one place: a budget they plan, the money that actually moves, and what they are worth. It is a two-sided
ledger: every account's balance is the sum of what was entered against it, and every expense says where the money came from. It is an app of the
Sovereign suite exactly as Tusk and Fjord are: a program of its own, which an instance can host, and which needs no instance to run.

Ledger replaces the legacy plugin `sovereign-plugin-ledger`. Its behaviour is the starting point; none of its code is carried over and none of its
data is migrated (§23).

What it must not give up, whatever the convenience:

- **Private by default.** A net-worth picture is about as sensitive as personal data gets. It is seen by its owner alone, held on a server they
  chose, and nothing of it goes to a third party: exchange rates are fetched by the server, by currency code, and nothing else leaves.
- **Many currencies, natively.** An account, a bill and a budget each have their own currency, and everything still rolls up into one picture in the
  base currency, at the rate of the day each amount happened (§9).
- **The numbers add up.** A balance is never typed over: it is derived, and a correction is an entry that says so (§6.4). A report for a past month
  shows what was budgeted then, not now (§7.3).
- **Logging is quick.** Adding an expense is one dialog, from anywhere, with the account, category and payee remembered. Recurring bills post
  themselves when asked to (§8).
- **A person can leave.** One file holds everything (§16), and deleting the account deletes what is held of them (§17).

What it is not: an accounting package for a business (no invoices, VAT or double-entry jargon on screen), a bank aggregator, or an investment tracker
with live prices.

## 2. Phases

| Phase          | What it delivers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1, the MVP** | On the web, responsive and installable: accounts and sign-in, local and through core; currencies and daily rates; accounts of every kind with opening balances, reconciling and revaluation; expenses, income and transfers with splits, payees and cleared status; the transactions list; the budget with history; recurring entries; saving jars; monthly and yearly reports, net worth over time and charts; insights; the month-end review and recap; export, import and deletion. Runs alone or hosted. |
| **2**          | Candidates, none committed: shared household books (§5.3), CSV import, receipts as attachments, crypto rates, budget rollover, a phone's own screens, AI insights through the instance's model provider.                                                                                                                                                                                                                                                                                                     |

### 2.1 What is carried over

The plugin's task IDs (`L.<n>`) are not used here. This table is how to check nothing was lost.

| Plugin                                                                                                         | Here                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Setup wizard (currency, income, category chips) + checklist                                                    | §15.3, with a first account added                                                                    |
| Currencies: all ISO 4217 + BTC, per-currency decimals                                                          | §9, **fiat only:** BTC is dropped until a crypto feed exists (§23)                                   |
| Daily FX job (Frankfurter, USD pivot), rate at each date                                                       | §9.2                                                                                                 |
| Incomes, primary and secondary                                                                                 | §7.4, now with income received as well as budgeted                                                   |
| Categories (dynamic / fixed / saving) → kinds                                                                  | §7: categories → subcategories. "Fixed" becomes a subcategory budgeted by its recurring bills (§7.2) |
| Expenses against a kind; edit, delete                                                                          | §6.2: an expense now comes from an account                                                           |
| Saving jars with their own balance                                                                             | §10: a jar is an earmark inside a real account                                                       |
| Bank accounts, credit cards, assets, deposits                                                                  | §6.1: accounts whose balance is derived                                                              |
| Loans with an auto-made fixed expense, payments reduce it                                                      | §6.1, §8.3: a loan makes its own recurring instalment, split into principal and interest             |
| People, a signed ledger with history                                                                           | §6.1: a person is an account                                                                         |
| Reports: periods, three savings figures, mini overviews                                                        | §11                                                                                                  |
| Month-end review; recap on the 1st by email and notification                                                   | §11.4, §11.5                                                                                         |
| Insights: over-budget streak, unusually large expense                                                          | §12                                                                                                  |
| Export, import, delete (platform portability)                                                                  | §16, §17, as the app's own                                                                           |
| Mobile fork, FAB, drawer                                                                                       | §14.6: one responsive tree, a PWA                                                                    |
| Concept backlog never built: recurrence, fixed actuals, auto jar contributions, yearly reports, budget history | §8, §10.2, §11.1, §7.3                                                                               |
| Tenants, `sdk.db`, the plugin manifest, `schedules`                                                            | Gone with the legacy runtime (§13, §19)                                                              |

## 3. User journeys

1. **First visit, alone.** Someone runs the image (§19). They register and land in setup: a base currency, a first account with what is in it today,
   their primary income, and a few categories picked from suggestions with amounts filled in. Under a minute later they are on Overview.
2. **First visit, on an instance.** They open Ledger from the launcher, sign in through core, and find the same setup.
3. **Log a coffee.** From any page, _Add_ opens with today's date, the last account used and the cursor in the amount. They type 3.40, pick
   _Food · Eating out_, and press Enter.
4. **Pay the card.** At the end of the month they record a transfer from Checking to the credit card. The card's balance falls to zero; nothing is
   counted as spending twice.
5. **Split a receipt.** A supermarket receipt of 84.20 is split into Groceries 61.00 and Household 23.20.
6. **Bills post themselves.** Rent is a recurring bill on the 1st, posting by itself. The electricity bill is set to "confirm": on its day it shows
   as upcoming, and they correct the amount before posting it.
7. **Reconcile.** The bank's app says 2,431.18; Ledger says 2,429.98. They reconcile Checking to the statement; Ledger records an adjustment of
   1.20 and marks the entries up to today cleared.
8. **Save for a trip.** They make a _Travel_ jar inside Savings with 150 a month. Each month 150 of Savings is earmarked. When they book a flight,
   they pay it "from the Travel jar" and the earmark is released.
9. **The month ends.** On the 1st a recap arrives in core's bell and by email. In Reports they see last month needs review, look at the three savings
   figures and the categories that ran over, raise the Groceries budget from this month on, and mark the month reviewed.
10. **Look back.** The yearly view shows 2026 by category against budget, and a chart of net worth month by month.
11. **Leave.** They download one file of everything, or delete their account: Ledger deletes what it holds of them.

## 4. Terminology

| Term                | Meaning                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account**         | On screen, a money account. In code, `account_id` is someone who can sign in (as in Tusk), and a money account is `money_account`; "person" means a signed-in account, in prose |
| **Book**            | Everything of one budget: its accounts, transactions, categories and settings. In phase 1 each person has exactly one (§5.3)                                                    |
| **Money account**   | A place money is or is owed: a bank account, cash, a card, a loan, a person (§6.1). "Account" on screen                                                                         |
| **Transaction**     | One event: an expense, an income, a transfer, or an opening, adjustment or revaluation (§6.2)                                                                                   |
| **Line**            | One part of a transaction: an amount against a money account, a subcategory, an income source, or equity (§6.3)                                                                 |
| **Payee**           | Who was paid, or who paid (§6.5)                                                                                                                                                |
| **Category**        | A group of subcategories, in one currency (§7.1)                                                                                                                                |
| **Subcategory**     | What an expense is labelled with, and what has a budgeted amount                                                                                                                |
| **Income source**   | Where income comes from, with a budgeted amount: primary or secondary                                                                                                           |
| **Budgeted, spent** | What was planned for a month, and the expenses that happened in it. Code may say `planned`, `actual`; the screen never does                                                     |
| **Recurring entry** | A rule that makes a transaction every N days, weeks, months or years (§8)                                                                                                       |
| **Saving jar**      | Money set aside for a purpose inside a money account (§10)                                                                                                                      |
| **Base currency**   | The book's currency for totals and reports                                                                                                                                      |
| **Net worth**       | What the money accounts add up to, in the base currency                                                                                                                         |
| **Month**           | A calendar month in the book's time zone, `YYYY-MM`                                                                                                                             |

User-facing text says "budgeted", "spent", "subcategory", "account" and "app"; never "predicted", "actual", "kind", "ledger entry", "debit",
"credit" (except "credit card"), "client" or "plugin".

## 5. Architecture

```
       browser (a PWA)                                 server (one image, one process)
 ┌──────────────────────────────────┐            ┌──────────────────────────────────────────────┐
 │ UI (React 19, @sovereignfs/ui)   │  server    │ Next.js: the shell, routes, server actions   │
 │ screens read through the server  │  actions,  │ better-auth (§13)                            │
 │ add dialog, lists, reports       │ ◀────────▶ │ the ledger: writes in one transaction each,  │
 │ service worker: the shell only   │  /api/*    │   the permission in the statement            │
 └──────────────────────────────────┘            │ reports: pure functions over rows            │
                                                 │ jobs: rates, recurring, recap                │
                                                 └───┬──────────────┬───────────────┬───────────┘
                                                     │              │               │
                                              SQLite (sqld   Frankfurter      a Sovereign core,
                                              or a file) or  (rates, §9.2)    if one is set
                                              PostgreSQL (§18)
```

- **Online, and the server decides.** Phase 1 has no offline mode and no personal key (§23): screens are rendered from the server, and every write
  is a server action or route that checks the session and carries the permission in its statement. The add dialog answers at once and is undone on
  a refusal, as a Tusk board does.
- **Next.js with React 19**, a long-running server and not serverless, because the jobs are background work.
- **SQLite by default, in production too, and PostgreSQL if the operator prefers** (§18).
- **Jobs run in the web process**, on a timer started from `instrumentation.ts`, with `LEDGER_WORKER=off` for all but one process if several share a
  database. Every job claims its work in the database, so a second process running it is safe anyway (Tusk §5).
- **The server talks to Frankfurter and to core.** The browser never does.
- **What can be pure is pure:** money arithmetic and rounding, conversion at a date, the next occurrence, the monthly equivalent of a recurring
  amount, the budget in force for a month, every report figure and every insight. They take the time and the rows as arguments, so they are tested
  with no clock and no database.

### 5.1 Where things go

As Tusk's: `app/` for routes, `src/` for everything else, tests beside the code.

| Path                      | What                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `app/`                    | Routes: the landing page, sign-in, the signed-in area, `/api/*`                                                     |
| `src/db/`                 | Configuration, clients, schemas per dialect, migrations at start-up (§18) — **copied from Tusk**                    |
| `src/auth/`               | better-auth, its settings, the screens, the fake Sovereign for tests (§13) — **copied from Tusk**                   |
| `src/access/`             | Every page and route with who may use it; `bookRoute`; input parsers (§5.2)                                         |
| `src/money/`              | Minor units, currencies and their decimals, formatting, rounding, conversion (§9) — pure                            |
| `src/fx/`                 | The rate table, the fetch job, "the rate in force on a date" (§9.2)                                                 |
| `src/ledger/`             | Money accounts, transactions and lines, payees, balances, reconciling, revaluation (§6)                             |
| `src/budget/`             | Categories, income sources, budgeted amounts with history, the monthly equivalent (§7)                              |
| `src/recurring/`          | Rules, the next occurrence, posting and "upcoming" (§8) — the rule copied from Tusk's `recurrence.ts`               |
| `src/jars/`               | Jars and their movements (§10)                                                                                      |
| `src/reports/`            | Month and year figures, net worth over time, the review, the recap (§11) — pure over rows                           |
| `src/insights/`           | The rules (§12) — pure                                                                                              |
| `src/portability/`        | The file format, export and import (§16)                                                                            |
| `src/sovereign/`          | Core's notices, `People.deletePerson`, the bell, email and activity calls (§13, §17) — **from Tusk**                |
| `src/jobs/`               | The runner and claims — **copied from Tusk**                                                                        |
| `src/crypto/`             | Envelope encryption under `LEDGER_ENCRYPTION_KEY` — **copied from Tusk**, used by nothing in phase 1 but SMTP (§19) |
| `src/mail/`               | The SMTP mailer — **copied from Tusk**                                                                              |
| `src/screens/`, `src/ui/` | The signed-in screens and the shell                                                                                 |
| `migrations/`, `deploy/`  | Generated SQL (`sqlite/`, `postgres/`, `auth/`); the Compose setups                                                 |

**Copied from Tusk** (building-an-app §15: until the kit is published, an app copies, and says which files): `src/db/` (boot, retry, sqld
namespaces, migrations at start-up, the column vocabulary, `exec.ts`, `test-support.ts`), `src/jobs/`, `src/auth/` and its fake Sovereign,
`src/sovereign/` (notice routes, verifiers, identity, the shape of `people.ts`), `src/crypto/`, `src/mail/`, `src/config/`, `src/security/` and
`proxy.ts`, `src/limits/`, `src/sw/`, `src/theme/`, `scripts/` (db-generate, boot-check, deploy-check, the release script), the Dockerfile and
`deploy/`. Each is renamed to `LEDGER_` and trimmed of what Ledger does not use (sync, workspaces, the cipher); none is changed in behaviour without
saying so in its task.

### 5.2 Access

**The permission is in the statement.** Every row of a book carries `book_id`, and every read and write names it together with membership:
`… WHERE book_id = ? AND EXISTS (SELECT 1 FROM book_member WHERE book_id = ? AND account_id = ?)`. Never checked first and then touched; a refusal
reads as not found. Anything a write points at (an account, a subcategory, a payee, a jar) must be the same book's, in the same statement.

- `bookRoute` finds the session, checks `Origin` on a write, and resolves the person's book. Phase 1 has one book per person, so no route names one.
- `src/access/routes.ts` lists every page and route with who may use it; a test calls each as a second, signed-in person and expects not found.

### 5.3 Books, and households later

Everything a person budgets belongs to a **book**, not to the person directly: `book` and `book_member (book_id, account_id, role)`. Setup makes one
book with the person as its `owner`, and phase 1 never makes a second or adds a member. This costs one join and buys households later (§2) without
rewriting a statement: the permission is already membership, as Tusk's boards are. What phase 2 would add is a `member` role, an invitation, whose
name is on a transaction (`created_by`, already kept), and what deletion does to a shared book; none of it is designed now.

## 6. Accounts and the ledger

### 6.1 Money accounts

| Type          | Side      | What                                                                                   |
| ------------- | --------- | -------------------------------------------------------------------------------------- |
| `bank`        | asset     | A current account. A name the person picks and an institution, never an account number |
| `cash`        | asset     | A wallet                                                                               |
| `savings`     | asset     | A savings account; where jars usually live                                             |
| `deposit`     | asset     | Money held as security (a flat's deposit)                                              |
| `investment`  | asset     | Shares, funds, a pension: valued by revaluation (§6.6)                                 |
| `property`    | asset     | A car, a flat: valued by revaluation                                                   |
| `credit_card` | liability | With a credit limit; shows how much of it is used                                      |
| `loan`        | liability | Lender, principal, start and end, instalment, optional yearly interest rate (§8.3)     |
| `person`      | either    | Someone who owes the owner money, or whom they owe                                     |

- **One currency per account,** chosen when it is made and never changed (a change would re-price its history).
- **A balance is derived:** the sum of the account's lines. It is never stored as the truth; a cached figure may be kept for lists if a test holds it
  equal to the sum.
- **Signs:** a line on an account is positive when the account's balance goes up. A liability's balance is negative while money is owed (a card at
  −420.00); a person's is positive when they owe the person. The screen shows owed amounts without a minus, with words ("you owe", "owes you").
- **Archive** hides an account from pickers and lists, keeps its history and its place in past reports. **Delete** is offered only for an account
  with no lines but its opening balance.
- A credit card shows used = −balance and available = limit + balance. A loan shows what is left, paid so far, and the end date.

### 6.2 Transactions

A transaction has a date (`YYYY-MM-DD`, no time zone), a type, an optional payee and note, a status (§6.7), and two or more lines (§6.3).

| Type          | Lines                                                                                   | Shown as                        |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------- |
| `expense`     | One money account (negative), and one or more subcategories (positive), adding up to it | "Expense"                       |
| `income`      | One money account (positive), and one or more income sources (negative)                 | "Income"                        |
| `transfer`    | Two money accounts, one down and one up                                                 | "Transfer"                      |
| `opening`     | One money account and equity                                                            | "Opening balance"               |
| `adjustment`  | One money account and equity                                                            | "Adjustment" (from reconciling) |
| `revaluation` | One investment or property account and equity                                           | "Value updated"                 |

An expense may also carry a line on a liability, so a **loan instalment** is one expense: the bank down by the instalment, the loan up by the principal,
the interest subcategory up by the interest (§8.3). The rule is general: **the lines of a transaction add up to zero in its currency.** The one
exception is a transfer between two accounts of different currencies, which records both amounts (§6.8).

A refund is an expense with a negative amount (the subcategory's spent goes down); money received from a person who owed it is a transfer from that
person's account.

### 6.3 Lines

A line names exactly one of: a money account, a subcategory, an income source, or equity (`opening`, `adjustment`, `revaluation`). It has a signed
amount in minor units and its currency. Lines on budget targets are in the transaction's currency (the paying account's), whatever the category's
currency: spent is converted to the category's currency at the transaction's date for the budget (§7.2).

### 6.4 Opening balances and reconciling

- **Opening balance:** making an account asks what is in it and on which date; that is an `opening` transaction. A person can edit it later.
- **Reconcile:** the person enters the statement's balance and date. Ledger shows the difference from the balance of cleared entries up to that
  date; confirming records an `adjustment` for it (if not zero) and marks every pending entry up to the date cleared. An adjustment is never a hidden
  edit of another entry.

### 6.5 Payees

A payee is a name in the book, made the first time it is typed and offered by autocomplete after. It remembers the last subcategory and account used
with it, which the add dialog proposes. Payees can be renamed, merged (lines move to the survivor) and archived. A payee's page shows its total by
month.

### 6.6 Revaluation

An investment or property account is valued, not traded: "value on date" records a `revaluation` of the difference against equity. It is neither
income nor spending, and appears in net worth (§11.3) as a change in value. Quantities and unit prices are phase 2.

### 6.7 Status

Every transaction is `pending` or `cleared`. New entries are pending, except openings and adjustments. Reconciling clears; a person can clear or
un-clear one by hand. Status changes no figure; it is a reconciling aid, and a filter of the list.

### 6.8 Currencies in a transaction

- An expense or income is in its money account's currency. Paying a USD amount with a EUR card is entered in EUR (what the card charged); an optional
  "original amount" note keeps the USD figure, informational only.
- A transfer between accounts of two currencies records the amount that left and the amount that arrived; the rate actually used is their ratio, shown
  and never stored apart.

### 6.9 The transactions list

`/transactions`: every entry of the book, newest first, paged by date. Filters, which combine and live in the address: money account, category or
subcategory, payee, type, status, date range, and a search of payee and note text. Each row shows date, payee, category (or "Split"), account, amount
and status; a running balance is shown when exactly one account is filtered. A row opens the same dialog as Add, to edit or delete. Bulk: clear,
change category, delete.

## 7. The budget

### 7.1 Categories and subcategories

A category has a name, a currency (the base currency by default) and an order; a subcategory has a name and an order inside it. Expenses are labelled
with subcategories. A category or subcategory with expenses can be archived but not deleted; one without can be deleted.

### 7.2 Budgeted and spent

- **Spent** for a subcategory and month is the sum of its lines on transactions dated in that month, converted to the category's currency at each
  transaction's date (§9.3).
- **Budgeted** comes from the budget history (§7.3). A subcategory is either **set by hand** or **budgeted by its bills**: the monthly equivalent of
  its recurring entries (§8.4). Bills that repeat less often than monthly are spread: a yearly 600 is 50 a month, while the spending lands in the month
  it is paid.
- Totals roll up: subcategory → category → the budget, each converted to the base currency for the totals.
- **No rollover.** Each month starts at its budgeted amount. Money meant to carry forward goes into a jar (§10).

The Budget screen groups subcategories into **Bills** (budgeted by their recurring entries), **Spending** (set by hand) and **Saving** (jars and
their monthly contributions), with a budgeted-vs-spent bar per row and a month picker. Selecting a row shows its transactions this month and its
budget history.

### 7.3 History

Budgeted amounts are effective-dated: `budget_amount (book_id, target, from_month, amount)`, the amount in force for a month being the latest row whose
`from_month` is not after it. Changing a budget asks "from this month" or "from next month", and writes a row; it never rewrites a past month. A
budget that ends writes a zero. Income sources (§7.4) and jars' monthly contributions (§10) use the same table.

### 7.4 Income

Income sources (one primary, any number of secondary) each have a budgeted monthly amount, with history. **Income received** is the income
transactions dated in the month. Reports show budgeted and received side by side; projected savings use budgeted income, actual savings use received
(§11.2).

## 8. Recurring entries

### 8.1 The rule

Every N days, weeks, months or years from an anchor date, optionally until an end date: Tusk's rule format and pure next-occurrence function, copied
(§5.1). Monthly on the 31st falls on the last day of shorter months.

### 8.2 What a recurring entry is

A template of a transaction (type, money account, lines, payee, note) plus the rule, a **mode** and the date of its next occurrence.

- **`auto`:** on its date, the job posts the transaction (pending), and moves the next date on. The person edits it afterwards if the real amount
  differed.
- **`confirm`:** on its date it appears as **upcoming** on Overview and the transactions list, with the template's amount; the person posts it as
  is, edits and posts, or skips this occurrence. Overdue upcoming entries stay until handled; they are counted in the bell (§13.4).
- Posting is idempotent: a transaction made from a recurring entry carries `(recurring_id, occurrence_date)`, unique, so a job run twice or two
  processes racing post it once.
- Editing a recurring entry changes future occurrences only; posted transactions are ordinary transactions.

### 8.3 Loans

Making a loan account offers its instalment as a recurring entry: from a chosen bank account, on a day of the month, mode chosen. Each occurrence is
an expense of three lines (§6.2): the bank down by the instalment; the loan up by the principal part; an interest subcategory (made with the loan, in
a _Loans_ category) up by the interest part. With a yearly rate set, interest = what is left × rate × days / 365, rounded to the minor unit, and
principal is the rest; without, the whole instalment is principal and the person can split it when confirming. The last instalment is capped at what
is left. The recurring entry ends when the loan is paid off or its end date passes.

### 8.4 Monthly equivalent

For a subcategory budgeted by its bills, the budget in force from a month is the sum of its recurring entries' monthly equivalents: daily × 365/12,
weekly × 52/12, monthly ÷ N, yearly ÷ 12N, converted at the rate in force and rounded. Making, editing or ending such a recurring entry writes the
subcategory's `budget_amount` from the current month (§7.3), so history works the same way for both kinds of budget.

## 9. Currencies and exchange rates

### 9.1 Currencies

Every ISO 4217 fiat currency, each with its own decimals (JPY 0, EUR 2, BHD 3), from a table generated from ICU (as the plugin's
`scripts/generate-currencies.ts`). A book has a base currency and the currencies it uses (added when an account or category needs one). The base
currency can be changed; every figure is then reported in the new one, with nothing stored re-priced. **No crypto in phase 1.**

Money is integer minor units, always; a currency's amount is formatted with its own decimals in the person's locale.

### 9.2 Rates

- A daily job fetches, from Frankfurter (no key), the rate against USD of every currency some book uses, and stores one row per currency and day:
  `fx_rate (currency, as_of, rate)`. A currency Frankfurter does not cover is left out of the request, not allowed to fail it. A fresh instance makes
  no request at all.
- The rate between two currencies on a date is derived from their USD rates in force on that date: the latest row not after it. No row → no rate.
- Rates are instance-wide, not a person's: the table has no `book_id`, and the only thing that reaches Frankfurter is a list of codes.
- `LEDGER_FX_URL` overrides the source's address (for a mirror or a test); `LEDGER_FX=off` turns fetching off.

### 9.3 Conversion

An amount is converted at the rate in force on its own date, never today's, and rounded half to even to the target's minor unit. A rate is stored as
a decimal string and converted exactly (no floating point in money). An amount with no rate available is **not included** in a converted total, and
the total says so ("1 amount in USD not included") rather than guessing. Net worth at a month end uses that day's rates (§11.3).

## 10. Saving jars

### 10.1 What a jar is

A jar is money set aside for a purpose **inside a real money account** (asset side only): a name, the account, an optional target, and a monthly
contribution (with history, §7.3). Its balance is the sum of its movements: `jar_movement (jar_id, date, amount, transaction_id?)`. Nothing moves
between accounts when money is earmarked; the account's balance is unchanged, and the account shows "of which in jars" and "free".

### 10.2 Movements

- **Monthly contribution:** on the 1st, the recurring job earmarks each jar's contribution (once per jar and month, by a unique key). It is skipped,
  and Overview says so, if the account's free money would go below zero.
- **By hand:** earmark more, or release some.
- **Spending from a jar:** an expense from the jar's account can be marked "from the jar"; it releases the same amount (a movement pointing at the
  transaction). Deleting the expense deletes the movement.
- **Never past what is there:** an earmark cannot make the account's jars exceed its balance, and a jar cannot go below zero. If spending later takes
  the account below what its jars hold, the account shows "over-earmarked" and asks which jar to release.

### 10.3 In the budget and reports

The Saving section of the budget shows each jar's monthly contribution, balance and progress to target. Contributions are not spending; reports show
actual savings both before and after them (§11.2). Moving a jar to another account is a release from one and an earmark in the other.

## 11. Reports and the month-end review

### 11.1 Views

`/reports` has a month view and a year view, by category and by subcategory, with budgeted vs spent at every level, totals in the base currency, and
the "not included" note when a rate is missing. The month list shows each month with income received, spent and its review status; the current month
is "In progress".

### 11.2 Figures

For a month (and summed for a year):

- **Income:** budgeted and received.
- **Spent:** the sum of expense lines on subcategories (loan interest included; loan principal is a transfer of debt, not spending).
- **Three savings figures:** _projected_ = budgeted income − budgeted spending; _actual_ = income received − spent; _actual after jars_ = actual −
  jar contributions earmarked in the month.
- **Small summaries:** credit cards (balance, used of limit), people (owed to you, you owe), loans (left, paid this month).

### 11.3 Net worth over time

Net worth at a date = the sum of every money account's balance at that date, converted at that date's rates; the history is the month ends,
computed from the lines (opening, revaluation and adjustment included), so no snapshot is stored. Its chart shows net worth by month with assets and
liabilities; others show spending by category for a month, and budgeted vs spent by month for a year. Charts are built in `@sovereignfs/ui` first
(§14.5).

### 11.4 Review

A past month without a review is "Needs review", and Overview shows a banner for the most recent one. The review is the month's report plus two
actions: **adjust budgets** (opens the budget for the next month, writing history rows) and **mark reviewed** (idempotent; can be undone).

### 11.5 Recap

On the 1st, in the book's time zone, the recap job claims `(book, month)` once and sends the previous month's figures: income, spent, the savings
figures, the three categories most over budget, and any insight, with a link to the month's report. Through core's bell and core's email when hosted;
through the app's own SMTP when alone; neither if neither is set (§13.4). A person can turn the recap off in Settings.

## 12. Insights

Rule-based, computed when a page needs them, never stored.

- **Over budget again:** a subcategory spent more than budgeted for N consecutive completed months (N = 2), counting back from the last completed
  month.
- **Unusually large:** an expense more than three times the median of its subcategory's expenses over the last six months, with at least five to
  compare.

Shown on Overview (at most three) and in a month's report, in plain words with links. A rule needs enough history to speak, so a new book shows none.
More rules are added the same way, each with a test seen to fire and to stay silent.

## 13. Sign-in and core

### 13.1 Sign-in

**Identical to Tusk's §6 (and Fjord Web's), with `LEDGER_` for `TUSK_`:** better-auth in a store of its own; local accounts (password, passkey,
authenticator app) when `LEDGER_AUTH_LOCAL=1`; a Sovereign core through `genericOAuth` with PKCE when `LEDGER_CORE_*` are set; both from one image.
Sign-up is `closed` by default with local accounts on, `open` when core is the only way in. A person is their better-auth user id; a `sub` is never
matched by email. Scopes `openid profile email`.

### 13.2 Notices

Back-channel logout at `/api/sovereign/backchannel-logout`, account-deleted at `/api/sovereign/account-deleted`, both checked by the SDK
(`verifyLogoutToken`, `verifyAccountDeletedToken`), a replayed `jti` refused after a restart, 404 where core is not set. Account deleted runs
`People.deletePerson` (§17) and answers `200` only once done.

### 13.3 The manifest

```json
{
  "manifest": 2,
  "prefix": "ledger",
  "name": "Ledger",
  "description": "Your budget, your accounts and your net worth, in every currency you use",
  "icon": "/icons/icon.svg",
  "port": 3003,
  "health": "/api/health",
  "launch": "/",
  "signIn": {
    "redirect": ["/api/auth/callback/sovereign"],
    "backChannel": "/api/sovereign/backchannel-logout",
    "accountDeleted": "/api/sovereign/account-deleted",
    "scopes": ["openid", "profile", "email"]
  },
  "database": true,
  "generate": ["LEDGER_AUTH_SECRET", { "name": "LEDGER_ENCRYPTION_KEY", "bytes": 32 }],
  "core": ">=0.57.0 <1.0.0"
}
```

The `core` floor is the release that shipped the app scopes Ledger calls; it is checked against core's changelog in the task that calls them (10.1)
and raised if needed. `pooling` is not set: the jobs' claims are conditional updates and need no session state, but nothing is gained by asking.

### 13.4 Core's services

With the app scopes an operator grants (`notifications:send`, `email:send`, `activity:write`), through `@sovereignfs/sdk` on the server:

| What                                   | Through                              | Alone                         |
| -------------------------------------- | ------------------------------------ | ----------------------------- |
| The month's recap                      | Bell and email                       | Email through `LEDGER_SMTP_*` |
| Upcoming bills waiting to be confirmed | Bell, once a day, with a count       | Overview only                 |
| An insight that newly fires            | Bell, once per insight and month     | Overview only                 |
| Export, import, delete everything      | A line on the person's activity page | Nothing                       |

Each send has a `key` so a repeat in a day is one send. A `NotSupportedError` from an older core, or no core, sends nothing and changes nothing else.
Phase 1 has no notification list of its own.

## 14. Interface

### 14.1 Principles

`@sovereignfs/ui` throughout, imported directly; `--sv-*` tokens only; Hanken Grotesk served by the app. Amounts are tabular figures, right-aligned,
with their currency; negative is never shown by colour alone. Every surface has a loading state and an empty state that says what to do next.

### 14.2 The shell

A sidebar (Overview, Transactions, Budget, Accounts, Reports) with **Add** pinned above it; Settings from the avatar menu, as Tusk's. Without an
instance, the `Header` carries the app's own avatar menu; with one, the launcher and core's bell.

### 14.3 Screens and addresses

| Address         | What                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/`             | Landing page for a visitor; Overview when signed in (setup until done)                                           |
| `/setup`        | The setup wizard (§15.3), full-bleed                                                                             |
| `/transactions` | The list (§6.9); filters in the query                                                                            |
| `/budget`       | The budget for a month (`?month=`), a selected row in `?row=` opening the detail column                          |
| `/accounts`     | Money accounts grouped by side, net worth; `/accounts/<id>` an account's entries, reconcile, jars, loan schedule |
| `/reports`      | Months and years (`?month=`, `?year=`), charts, the review                                                       |
| `/payees/<id>`  | A payee's totals                                                                                                 |
| `/account`      | Settings, as a dialog over the page and as a page (Tusk §19)                                                     |

Overview: this month (income received, spent, projected and actual saved), net worth, jars total, upcoming bills, budget categories closest to or
over budget, insights, recent transactions, and the setup checklist until it is done or dismissed.

### 14.4 The add dialog

`Dialog` on a wide screen, `Drawer` on a narrow one, same content: type (Expense, Income, Transfer), amount (`CurrencyInput` with the account's
decimals), account, payee (autocomplete, proposing its last subcategory), subcategory or income source, date (today), note, "from a jar", and
**Split** to add lines until they add up. Enter saves; "Save and add another" keeps the date and account. It answers at once and is undone on a
refusal. A date in another month says which month it counts towards.

### 14.5 Design system

Available: layouts, `Header`, `Dialog`, `Drawer`, `Sheet`, `DataTable`, `Table`, `DatePicker`, `CurrencyInput`, `Combobox`, `SuggestionInput`,
`Progress`, `BalanceChip`, `StatusBadge`, `SystemBanner`, `SegmentedControl`, `StepStrip`, `EmptyState`, `ConfirmDialog`, `Pagination`.
**Missing, and built in `@sovereignfs/ui` first:** charts (a line or area chart for net worth over time, a bar chart for budgeted vs spent and
spending by category), accessible (a table of the same data beside each), token-coloured, with no chart library loaded from elsewhere. A
`MoneyInput` binding `CurrencyInput.decimals` to a currency, and a currency picker, are Ledger's own unless another app needs them.

### 14.6 Phone and PWA

One responsive tree: the same routes and decisions at every width, with only rendering forked (Tusk §17, the guide's rule). On a phone the sidebar
becomes `MobileFooter` (Overview, Transactions, Budget, Accounts; Reports from Overview), Add is a floating button opening the drawer, and detail
columns become full pages. Installable as a PWA; the service worker keeps the shell only, never a page with money on it.

## 15. Setup and settings

### 15.1 Settings

From the avatar menu (Tusk §19): **Book** (name, base currency, time zone, first day of the week, locale for numbers), **Currencies**, **Income
sources**, **Categories** (order, archive, delete), **Payees** (rename, merge, archive), **Notifications** (recap on/off), **Data** (export, import,
delete everything, §16, §17), and the account sections Tusk has (sign-in methods, passkeys, two-factor, linking core).

### 15.2 Time zone

The book's time zone decides what "today" and a month are for posting recurring entries, contributions and the recap. It is taken from the browser at
setup and changeable. Dates on transactions are calendar dates with no zone.

### 15.3 Setup

A wizard at `/setup`, each step a real write (a refresh loses nothing):

1. **Base currency** (from the locale, searchable).
2. **First account**: type, name, and what is in it today (its opening balance).
3. **Primary income**: name and monthly amount.
4. **First categories**: suggestions as chips with editable amounts (Housing, Groceries, Transport, Eating out, Utilities, Health, Fun), none made
   without a tap.

Then Overview, whose checklist offers the rest in any order: more accounts, cards and loans, secondary income, bills, jars, people. Add works from the
first screen.

## 16. Export and import

- **Export:** one JSON file of the book: settings, currencies, money accounts, transactions and lines, payees, categories, subcategories, income
  sources, budget history, recurring entries, jars and movements, reviews. A `format` and `version` at the top; ids kept. Not the rates (public) or
  sign-in data. Downloaded from Settings > Data, logged to core's activity.
- **Import:** into an empty book only (a new person, or after delete everything), validated whole before anything is written, written in one
  transaction, with new ids mapped consistently. A file from a newer version is refused with a sentence that says so.
- **A round trip is a test:** export, import into a second account, export again, and the two files match but for ids and times.

## 17. Account deletion and signing out

**`People.deletePerson`** (`src/sovereign/people.ts`, as Tusk's) deletes everything of an account, safe to run again, the `sub` link last: every book
where they are the only member, with every row carrying its `book_id` (in phase 1, all of them); their membership elsewhere (none in phase 1); claims
and markers of theirs; better-auth's rows; and the account. A test seeds one row of every table and finds nothing after; a new table fails it until it
is included.

Reached from Settings > Data (after the password, or a fresh session for a Sovereign-only account; it says what will go), and from core's
account-deleted notice (§13.2). **Delete everything** without deleting the account empties the book and returns to setup.

## 18. Data model and database

### 18.1 Database

**As Tusk's §23.1, with `LEDGER_`:** `LEDGER_DB_DIALECT` is `sqld` (default; namespaces `ledger`, `ledger_auth`), `sqlite` (`file:/data/ledger.db`,
`ledger_auth.db` beside it) or `postgres` (schemas `ledger`, `ledger_auth`). Drizzle, a schema and a migration set per dialect, generated and never
written by hand, applied at start-up under a lock; a parity test across dialects. Standard SQL, values bound; no `LISTEN/NOTIFY`, trigger, extension
or foreign key; **every deletion names what it deletes, in a transaction**. Tests run on all three and read `LEDGER_TEST_*` only.

### 18.2 Representations

As Tusk's column vocabulary: ids are UUIDs made by the server; times `epochMs`; booleans the vocabulary's word; dates `YYYY-MM-DD`; months `YYYY-MM`.
**Money is a 64-bit integer of minor units** (`bigint` on PostgreSQL, read as a `number` and checked to be a safe integer). Currency is a three-letter
code. A rate is a decimal string.

### 18.3 Tables

Beyond better-auth's, in the auth store. Every table but `fx_rate` and `job_claim` carries `book_id`.

| Table            | Columns                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `book`           | `id`, `name`, `base_currency`, `time_zone`, `first_day_of_week`, `locale`, `recap` (on/off), `setup_done_at`, `created_at`, `updated_at`                                                                              |
| `book_member`    | `book_id`, `account_id` (the key), `role` (`owner`), `created_at`                                                                                                                                                     |
| `book_currency`  | `book_id`, `code` (the key), `created_at`                                                                                                                                                                             |
| `money_account`  | `id`, `book_id`, `type`, `name`, `institution`, `currency`, `credit_limit`, `position`, `archived_at`, `created_at`, `updated_at`                                                                                     |
| `loan`           | `account_id` (the key), `book_id`, `lender`, `principal`, `start_date`, `end_date`, `instalment`, `yearly_rate` (decimal string), `interest_subcategory_id`                                                           |
| `payee`          | `id`, `book_id`, `name`, `last_subcategory_id`, `last_account_id`, `archived_at`, `created_at`                                                                                                                        |
| `txn`            | `id`, `book_id`, `type`, `date`, `payee_id`, `note`, `status`, `recurring_id`, `occurrence_date` (unique with `recurring_id`), `original_amount`, `original_currency`, `created_by`, `created_at`, `updated_at`       |
| `txn_line`       | `id`, `book_id`, `txn_id`, `account_id` \| `subcategory_id` \| `income_source_id` \| `equity` (exactly one), `amount`, `currency`, `position`                                                                         |
| `category`       | `id`, `book_id`, `name`, `currency`, `position`, `archived_at`, `created_at`                                                                                                                                          |
| `subcategory`    | `id`, `book_id`, `category_id`, `name`, `budget_source` (`manual`, `bills`), `position`, `archived_at`, `created_at`                                                                                                  |
| `income_source`  | `id`, `book_id`, `name`, `kind` (`primary`, `secondary`), `currency`, `archived_at`, `created_at`                                                                                                                     |
| `budget_amount`  | `book_id`, `target_kind` (`subcategory`, `income`, `jar`), `target_id`, `from_month` (the key with the two before), `amount`, `created_at`                                                                            |
| `recurring`      | `id`, `book_id`, `template` (JSON: type, account, lines, payee, note), `unit`, `every`, `anchor_date`, `end_date`, `mode` (`auto`, `confirm`), `next_date`, `loan_account_id`, `ended_at`, `created_at`, `updated_at` |
| `recurring_skip` | `recurring_id`, `occurrence_date` (the key), `book_id`                                                                                                                                                                |
| `jar`            | `id`, `book_id`, `account_id`, `name`, `target`, `position`, `archived_at`, `created_at`                                                                                                                              |
| `jar_movement`   | `id`, `book_id`, `jar_id`, `date`, `amount`, `txn_id`, `kind` (`contribution`, `manual`, `spend`), `month` (unique with `jar_id` for `contribution`)                                                                  |
| `month_review`   | `book_id`, `month` (the key), `reviewed_at`                                                                                                                                                                           |
| `book_job_mark`  | `book_id`, `job`, `period` (the key), `done_at`: the recap's month, the bell's day, an insight's month                                                                                                                |
| `fx_rate`        | `currency`, `as_of` (the key), `rate`, `source`, `fetched_at`                                                                                                                                                         |
| `job_claim`      | As Tusk's                                                                                                                                                                                                             |
| `notice_seen`    | A notice's `jti` and when, for replay (§13.2)                                                                                                                                                                         |
| `credential`     | As Tusk's (envelope encryption), unused in phase 1 but present with `src/crypto/`                                                                                                                                     |
| `rate_bucket`    | As Tusk's                                                                                                                                                                                                             |

Indexes follow the queries: lines by `(book_id, account_id, …)` with the transaction's date, by `(book_id, subcategory_id)`, by income source;
transactions by `(book_id, date)`, by payee, by status; `budget_amount` by target and month; recurring by `next_date`.

## 19. Security, deployment, testing

### Security

As Tusk's §24: a strict CSP with a per-request nonce, `connect-src 'self'`, no `'unsafe-inline'`; nothing third-party loads; text is rendered as text.
**Logs hold no amounts, names, payees or notes:** an id and a kind of failure. Every server action finds the session and carries the permission in
its statement; a route that changes something checks `Origin`. A security review of phase 1 is written up before its release, with access (§5.2) and
deletion (§17) at its centre.

### Licence

AGPL-3.0-or-later, since it bundles `@sovereignfs/ui`.

### Deployment

One image (Debian, for libSQL), not root, on port 3003, and three Compose setups in `deploy/`:

```bash
docker run -v ledger:/data -e LEDGER_DB_DIALECT=sqlite -e LEDGER_SQLITE_URL=file:/data/ledger.db \
  -e LEDGER_URL=https://ledger.example.com -e LEDGER_AUTH_LOCAL=1 -e LEDGER_AUTH_SECRET=… -e LEDGER_ENCRYPTION_KEY=… ghcr.io/sovereignfs/ledger
```

- **Settings** beyond the shared names (`contracts/env.md`): `LEDGER_WORKER`, `LEDGER_FX` and `LEDGER_FX_URL`. Each declared once in
  `@sovereignfs/config`, in `.env.example`, and in the README.
- **Hosted:** `sv app add ledger`, from the manifest; the operator grants the three app scopes and sets SMTP only if they want email when core's is not
  used.
- **Releases** as Tusk's: `scripts/release.sh`, a `vX.Y.Z` tag publishes amd64 and arm64 to `ghcr.io`; a patch has no migration.
- `/api/health` answers `200` once the database is ready.

### Testing

- **Vitest:** money, conversion, rounding, recurrence, the monthly equivalent, budget history, every report figure and insight as pure functions with
  hand-worked fixtures; the ledger's writes on all three databases.
- **The ledger's invariants as properties:** random sequences of transactions, edits and deletes, after which every transaction's lines add up, every
  balance equals its lines, and no jar exceeds its account.
- **Access:** every route and action called as a second person, expecting not found (§5.2).
- **Jobs:** each run twice and from two processes, posting once.
- **Sign-in** against the fake Sovereign; **notices** against `createFakeCore` from `@sovereignfs/sdk/testing`; **rates** against a fake Frankfurter.
- **Playwright** in Chromium and WebKit: setup, add, split, transfer, reconcile, a recurring confirm, the review, at desktop and phone widths.
- **A seed** (`pnpm seed`): a book a year deep, in two currencies, with every account type, splits, a loan, jars, recurring entries of both modes,
  reviewed and unreviewed months, and a missing rate.

## 20. What phase 1 leaves out

CSV import · bank sync · receipts and attachments · OCR · crypto rates · live prices and holdings × price · AI insights · shared household books
(§5.3 leaves room) · offline mode and personal keys · budget rollover · migration from the legacy plugin · a notification list of its own.

## 21. Not settled in the platform

- The kit of research 0004 is not published, so the infrastructure is copied from Tusk (§5.1); when the kit lands, Ledger adopts it in a task of its
  own.
- `AUTH_LOCAL` accepts `1` and `true` until `contracts/env.md` and the apps agree (building-an-app §15).

## 22. Open questions

- **Interest on a loan:** simple daily interest on what is left (§8.3) fits most consumer loans; a mortgage with a fixed amortisation table may not
  match to the cent. Accept "edit when confirming" as the answer for phase 1, or model the table?
- **Over-earmarked accounts (§10.2):** ask which jar to release, or release from the newest jar automatically?
- **The insight thresholds** (§12): N = 2 months and 3× the median are the plugin's spirit, not measured.

## 23. Decision log

| Date       | Decision                                                                                                          | Why                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 2026-11-08 | An app of its own, Tusk's shape: local + core sign-in, three database forms                                       | The suite's default; it must run with no instance                                         |
| 2026-11-08 | Name **Ledger**, prefix `ledger`, port 3003                                                                       | Kept from the plugin; its trademark note (plugin CONCEPT §7) is accepted                  |
| 2026-11-08 | **A full two-sided ledger**: balances derived, every expense from an account, transfers, openings and adjustments | The plugin's hand-typed balances could not reconcile with what was logged                 |
| 2026-11-08 | Splits, payees, loan interest split and cleared status in phase 1                                                 | What makes a two-sided ledger usable day to day                                           |
| 2026-11-08 | Saving jars are **earmarks inside a real account**                                                                | Matches real banks; no phantom accounts                                                   |
| 2026-11-08 | Investments and property by **manual revaluation**                                                                | No price feeds; quantities can come later                                                 |
| 2026-11-08 | Recurring entries **auto-post or confirm, per entry**                                                             | Stable bills should cost nothing; variable ones should be checked                         |
| 2026-11-08 | Budgeted amounts **keep their history**; bills less often than monthly are **spread monthly**; **no rollover**    | Past reports stay true; projected savings stay honest; jars carry money forward           |
| 2026-11-08 | **Server-side only** in phase 1: no offline mode, no personal key                                                 | Reports, the recap and recurring posting need the server to read the numbers              |
| 2026-11-08 | **One person per book**, with books and membership in the schema                                                  | Households are a later phase; the permission is already membership                        |
| 2026-11-08 | **Fiat only:** BTC dropped                                                                                        | The plugin listed it but never priced it                                                  |
| 2026-11-08 | Core's **bell, email and activity**                                                                               | The recap and due bills belong in the bell; export and delete belong on the activity page |
| 2026-11-08 | **No migration** from the plugin                                                                                  | No data needs to move                                                                     |
| 2026-11-08 | Not in phase 1: CSV import, receipts                                                                              | Scope                                                                                     |
