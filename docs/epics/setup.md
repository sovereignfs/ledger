# Epic 9: Setup and Overview

## Status

⏳ In progress: 2 of 3 tasks are done.

## Overview

The first minute, the page a person returns to, and the book's settings.

## Related

[`DESIGN.md`](../../DESIGN.md) §14.3, §15

## Tasks

#### ✅ 9.1 — The setup wizard

**Goal:** from nothing to a usable budget in a minute. **Design:** §15.3. **Depends on:** 4.1, 5.3.

**Technical:** `/setup`, full-bleed, a `StepStrip`: base currency (from the locale), first account and its opening balance, primary income, first
categories as chips with editable amounts (none made without a tap); each step a real write; time zone from the browser; `setup_done_at`; `/` goes to
setup until done.

**Accepts when:** a fresh account reaches Overview in four steps; refreshing mid-way loses nothing already entered; going back and forward makes no
duplicate.

**Done as:** **`/setup`**, full-bleed and outside the shell (`app/setup/page.tsx`), a wizard of four steps in a `StepStrip`. **What is done is read from the book** (`loadSetup` in `src/setup/setup.ts`): the next step is the first that is not (no base currency, no account, no primary income, then categories), so a refresh loses nothing, and **each step is safe to repeat**: `setupCurrency` sets the base currency and the browser's time zone (and can change it, re-pricing nothing) and adds the currency to the book's; `setupAccount` makes the first account in the base currency with its opening balance **unless the book has an account already, when it finds it** (a second tap or a trip back and forward makes no other); `setupIncome` finds or makes **the** primary source, renames it if the name changed and sets this month's budget again, which replaces this month's row and no other; `setupCategories` makes **only the categories chosen**, each a category with a subcategory of its name in the base currency with the amount as its budget from this month, **finding by name what is there** (so choosing it twice, or going back, makes none twice) and making nothing for what was not tapped; `finishSetup` sets `setup_done_at` once and keeps it. Every step goes through the paths the rest of the app uses (accounts, income sources, categories, budgets) and carries the permission. `src/setup/locale.ts` (pure) suggests the **currency from the browser's locale region** (`en-GB` pounds, `de-DE` euros, `si-LK` rupees, dollars where it cannot tell) and checks a time zone. `/api/setup` (GET the state; POST a step: `currency`, `account`, `income`, `categories`, `done`) is in `routes.ts` and called as the second person: the book is the session's, a request naming another is not obeyed, and another person's book is not touched. **`/` goes to `/setup` while the book is not set up** (`app/(app)/home/page.tsx`), `/setup` stays reachable afterwards, and **"Skip setup: I will do it myself"** finishes it for a person who has a book of their own already (as the tester of this app had). The e2e helpers set a book up as a person who has been through the wizard has, and `e2e/00-setup.spec.ts`, named to run first since the instance has the one account, walks the wizard from the front address: USD suggested, "Wizard bank" with $250.00, "Wizard pay" budgeted $3,000.00, Groceries with $400.00 and Fun with none, Overview, and no Housing; it then goes back and forward and reloads without a second account, and skips. Tested on all three databases: the four steps in order with the real account, categories and budgets behind them; three rounds of every step changing no count of accounts, sources, categories, subcategories, entries or budgets and each answering ok; a rename and a changed budget; a changed currency re-pricing nothing; refusals (no currency first, a currency, time zone, amount, name or kind that is not one, more than 20 categories) writing nothing; another person's book untouched. Each key test was seen to fail against the code it guards (a second account made, a category not found by name, finishing moving the time, the currency step without the permission, the region not upper-cased). Left out: the first account is a bank account, cash or savings (cards, loans and people come from Overview's checklist, 9.2), the suggested categories are the seven of the design and no other can be typed here (the Categories page makes any), and a second tap racing the first at once could make two accounts (a step is one person's one tap; the unique account name is not enforced).

#### ✅ 9.2 — Overview

**Goal:** where things stand, at a glance. **Design:** §14.3. **Depends on:** 9.1, 5.4.

**Technical:** this month (income received, spent, projected and actual saved), net worth, jars total, budget rows closest to or over budget, recent
transactions; the setup checklist (more accounts, cards and loans, secondary income, bills, jars, people) until done or dismissed, then a "Finish
setup" link. Upcoming bills (6.3), insights (8.7) and the review banner (8.5) join as those land.

**Accepts when:** a new book shows the checklist and Add works from it; a populated book shows figures equal to the month's report.

**Done as:** **`/` for someone signed in** (`app/(app)/home/page.tsx`; a book not set up is sent to the wizard from here). `src/overview/overview.ts` adds **no arithmetic of its own** but two differences: it gathers `loadIncome` (5.3), `loadBudget` (5.4), `loadOverview` (4.1's accounts and net worth), the latest eight entries and the book's accounts and sources, so **its figures are the budget screen's, the income page's and the accounts' own, and equal the month's report (8.1) by construction**, which a test shows by comparing them. `thisMonth` (pure): income received, spent, **saved so far** (received less spent) and **planned to save** (budgeted income less budgeted spending), in the base currency, with what any figure left out for want of a rate said in words and by which figure; a saving below nothing is shown as "short", never hidden; with no base currency yet each figure says to choose one and net worth is each currency's own. `closestRows` (pure): the rows with a budget in force and something spent, **most used first, over ones before the rest**, at most five, with "over by" in words. `checklist` (pure): more accounts, a credit card or a loan, a second source of income, bills, jars, people, each **done when the book has one** (an archived secondary source does not count); bills and jars are not built, so they say "Coming soon" and go nowhere, and the checklist is not shown at all when everything that can be done is. The client `SetupChecklist` has **Add an entry**, which opens the add dialog from it, and can be put away, which **this device remembers in `localStorage`** (a convenience of the viewer and not the book's) with a link that brings it back. The screen shows the four cards, net worth (money owed is said in words, "You owe … more than you have"), the closest rows, and recent transactions with each entry's status button, and an empty state for a book with no account. Tested on all three databases: this month's spent and received equal the screens', saved is their difference, the net worth of the accounts, the closest rows over before the rest with nothing from another month, eight latest entries, the checklist ticking as a card is added, and another person's Overview with nothing. 4 browser tests across Chromium and WebKit. Each key test was seen to fail against the code it guards (saved not a difference, the closest least used first, a row with no budget counted, an archived source counted as done). Left out, as the tasks that give them land: upcoming bills (6.3), insights (8.7), the month-end review banner (8.5), the jars total (7.1), and projected saving drawn from bills (6.4).

#### 📋 9.3 — The book's settings

**Goal:** everything setup chose, changeable. **Design:** §15.1, §15.2. **Depends on:** 2.6, 9.1.

**Technical:** Settings sections Book (name, base currency, time zone, first day of week, number locale), Currencies, Income sources, Categories
(order, archive, delete), Payees, Notifications (recap on/off).

**Accepts when:** changing the base currency re-reports every figure in the new one with nothing stored changed; changing the time zone moves when
the next recap and posting happen.
