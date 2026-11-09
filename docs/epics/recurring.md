# Epic 6: Recurring entries

## Status

✅ Done: 5 of 5 tasks.

## Overview

Bills and income that make their own transactions, each posting by itself or waiting to be confirmed; bills that set their subcategory's budget; a
loan's instalment split into principal and interest.

## Related

[`DESIGN.md`](../../DESIGN.md) §8, §7.2 · Tusk's `src/recurrence.ts`

## Tasks

#### ✅ 6.1 — The rule

**Goal:** the next occurrence, right in every month and zone. **Design:** §8.1. **Depends on:** 1.2.

**Technical:** Tusk's `src/recurrence.ts` copied and trimmed to every N days, weeks, months or years from an anchor, until an end; the 31st falls on
the last day of a shorter month; `monthlyEquivalent(rule, amount)` (§8.4), pure. Tests under three time zones.

**Accepts when:** worked examples (31 Jan monthly, 29 Feb yearly, every 2 weeks across a DST change) give the expected dates.

**Done as:** `src/recurring/rule.ts`, pure, **written and not copied from Tusk's `recurrence.ts`**, which this task said to copy and trim: Tusk's rule is an RFC 5545 `RRULE` run by the `rrule` package, which **skips a month that lacks the day** (a monthly rule on the 31st never lands in February), and `DESIGN.md` §8.1 says the opposite, that **the 31st falls on the last day of a shorter month**, so rent due on the 31st is due every month. That is a short piece of calendar arithmetic, so there is no new dependency, and the rule is the one `DESIGN.md` §18.3 stores (`unit`, `every`, `anchor`, `end`); Tusk's names are kept where they fit (`nextOccurrence`, `firstOnOrAfter`, an occurrences-between). **Every occurrence is counted from the anchor and not from the one before**, so 31 January monthly is 28 February and then 31 March, not 28 March; 29 February yearly is the 28th in a year that is not a leap year and the 29th again in the next that is; every 3 months from 30 November is 28 February and then 30 May. A date crosses into the arithmetic only through `Date.UTC` and comes back only through `getUTC*`, and the tests run the same dates under UTC, Los Angeles and Kiritimati (+14) with the clocks changing in March. `nextOccurrence(rule, after)` is the first occurrence strictly after a day (given the day an entry was last posted for, the day it is next due), `firstOnOrAfter`, `occurrenceIs`, and `occurrencesBetween` (the same dates that posting in turn would make, oldest first, at most `limit`), all found by a search over a sequence that only grows, bounded by the year 9999 so that a search always ends and no date is one the calendar cannot write; `null` once the rule has ended (the end is inclusive and the last occurrence is the last on or before it). **`monthlyEquivalent(rule, amount)`** is daily × 365/12, weekly × 52/12, monthly ÷ N and yearly ÷ 12N (a yearly 600 is 50 a month; every 2 weeks is half a weekly one), in integers, **rounded half to even** and keeping the sign; the conversion to the budget's currency is 6.4's. `checkRule` says in sentences what is wrong with a rule (every 1 to 999, a real start, an end not before it) and `describeRule` writes it for a screen ("Every 2 weeks, until 2027-06-30"). 18 tests: the worked examples above and a leap year, every 2 weeks across both clock changes, the three zones, strict next, ended rules, between against a walk of next-after-next, 300 random rules against the calendar (strictly increasing, the anchor's day clamped to the month's length, nothing between two occurrences), and the monthly equivalents with their halves. Each key test was seen to fail against the code it guards (the 31st skipping or clamping to 28, a next that is not strict, a monthly equivalent that ignores N, a leap day lost). No table or screen: recurring entries are 6.2.

#### ✅ 6.2 — Recurring entries and auto-posting

**Goal:** a template that posts itself. **Design:** §8.2. **Depends on:** 6.1, 4.3.

**Technical:** `recurring`; make one from a transaction ("Repeat…") or from scratch; edit future occurrences, end; the `post-recurring` job each hour:
for each book, the entries whose `next_date` is today or past in the book's zone and mode `auto`, posted through 4.2's path with
`(recurring_id, occurrence_date)` unique, then `next_date` moved on, catching up missed occurrences.

**Accepts when:** a monthly rent posts on the 1st once, even with the job run twice and from two processes; a server down for three days posts the
three missed occurrences once each.

**Done as:** two book tables, `recurring` (the template as JSON, the rule's `unit`, `every`, `anchor_date` and `end_date`, the `mode`, `next_date`, `ended_at`, and a
`loan_account_id` that 6.5 fills) and `recurring_skip` (primary key `(recurring_id, occurrence_date)`, which 6.3 writes), in both dialects by migration `0008`,
both in `BOOK_TABLES` and so deleted with the person and seeded in `people.test.ts`; `txn` already had `recurring_id` and `occurrence_date`, with a unique
index on the pair, so **the table itself refuses a second posting of an occurrence**. `src/recurring/recurring.ts`: `createRecurring` (from scratch: the
anchor is the first occurrence), `repeatEntry` ("Repeat…": the entry is the anchor's occurrence, tied to the series in the same statement that checks it is
the book's and does not repeat already, so the next to post is the one after it), `updateRecurring` (mode, end, how often counted from the next occurrence,
or the template; no posted entry is touched; an end before the next occurrence ends it), `endRecurring`, `listRecurring`, and `postOccurrence` / `postDue`.
**Posting is one transaction:** the claim (`UPDATE recurring SET next_date = <the one after> … WHERE next_date = <this one> AND ended_at IS NULL AND inBook(…)
RETURNING`) first, then the skip and already-posted checks, then the entry through `insertTransaction`, the same write path as any other (so a template that
no longer makes a valid entry, such as a subcategory archived since, **rolls the claim back, stays due and is tried again** each hour, and never wedges the
others). `postDue` takes every automatic, un-ended entry due by UTC's tomorrow, then decides each by **its book's own day** (a book in Kiritimati's 2nd is due
when it is the 2nd there), posts as the book's owner, and catches up at most 400 missed occurrences an entry per run. The job `post-recurring` runs at start
and hourly, logs only a count of failures, and is registered in `jobsFor`. Mode `confirm` is kept and never auto-posted: 6.3 lists and posts those. Routes
`/api/recurring` (GET, POST) and `/api/recurring/[id]` (PATCH, DELETE = end), with the template and the rule read as hostile input and checked again where
they are written; another person's is a 404 with nothing in it. **The screen:** _Repeat…_ in the edit dialog (how often, a stop day, "Ask me before it posts") and
a _Bills_ page (`/budget/bills`, linked from the Budget) that lists each entry with its amount, rule, next day and mode, to switch between _Posts itself_ and
_Asks first_ or to end. 21 data-layer and route tests on all three databases (concurrent runs, a three-day catch-up, skip, end, a failing template, time zone,
second person, the one-posting key) and 4 browser tests. Each key test was seen to fail against the code it guards (the mode filter, the skip check, the
permission on ending); removing the `next_date` condition from the claim alone changes nothing visible, because the already-posted check and the unique index
back it up, and is kept as the claim that keeps `next_date` from moving twice. Not copied from Tusk. Left out: upcoming and confirm (6.3), the budget (6.4), loans (6.5).

#### ✅ 6.3 — Upcoming, and confirming

**Goal:** variable bills checked before they are posted. **Design:** §8.2. **Depends on:** 6.2.

**Technical:** mode `confirm`: due occurrences listed as upcoming (Overview, the transactions list), each to post as is, edit and post, or skip
(`recurring_skip`); overdue ones stay until handled.

**Accepts when:** an electricity bill due today shows as upcoming, is posted with a corrected amount, and does not appear again; a skipped one is
gone and the next is scheduled.

**Done as:** `listUpcoming` (`src/recurring/recurring.ts`) is the next occurrence of each un-ended entry in mode `confirm` that is due by the book's today plus
seven days, marked _overdue_, _due_ or _coming_; one row for each entry, so handling it brings the following occurrence up as the next row, and an overdue
one stays until it is handled. `postOccurrence` took two options: `template` (the person's corrected version, in place of the stored one) and `expect` (the
occurrence the person was shown), and answers `stale` when the entry's next is another, so a second click, or a second window, posts nothing and says
so with a 409. `skipOccurrence` records the day in `recurring_skip` and moves the entry on, in one transaction; both share one `claim` statement with the
job. A corrected amount (`withAmount`, pure) replaces both lines of a plain two-line entry with the signs they had; a split or a two-currency entry is
posted as it is and edited afterwards, and a request to correct one is a 400 in a sentence. The stored template is never changed by a correction, so next
month asks the set amount again. Routes: `GET /api/upcoming`, `POST /api/recurring/[id]/post` (`{ date, amount? }`) and `/skip` (`{ date }`), another
person's a 404 with nothing in it. **Screens:** an _Upcoming_ panel (`UpcomingList`: _Post_, an amount to correct, _Skip_) on Overview and above the
transactions list, shown only when something waits. Not done here: **the bell's count of overdue ones (§13.4) is 10.1's**, since the bell is not built.
Tests: 14 more (10 on all three databases, 4 pure) (the list by state and by the book's day, one posting from a stale click, a skip and its record, the last occurrence
ending the entry, second person for every call) and 4 in the browser. Each key test was seen to fail against the code it guards (the stale check, the skip's
record, the mode filter of the list, the signs of a corrected amount).

#### ✅ 6.4 — Bills in the budget

**Goal:** a subcategory budgeted by its recurring entries. **Design:** §7.2, §8.4. **Depends on:** 6.2, 5.2.

**Technical:** a subcategory with `budget_source = bills` takes its budget from its recurring entries' monthly equivalents, converted at the rate in
force; making, editing or ending one writes the subcategory's `budget_amount` from the current month.

**Accepts when:** a yearly 600 insurance budgets 50 a month and its payment lands in the month paid; editing it to 720 from June changes June on and
not May.

**Done as:** `src/recurring/bills.ts`. **`billsFigure`** (pure) is the sum, over the un-ended recurring entries with lines on a subcategory, of each one's
`monthlyEquivalent` (6.1) in its lines' currency, converted to the category's currency at the rate in force today and rounded half to even; a refund line is
not a bill; an entry that cannot be converted for want of a rate is left out and **counted, never counted as nothing**. **`syncBills`** runs in the transaction
that changed the entries (making one or "Repeat…", editing its template or rule, ending it, and the last occurrence of one that ran out, in `claim`) for
every subcategory the old and the new template are spent on, and **writes the figure from the book's current month through `writeBudget`**, only when it is not
the one already in force, so a past month is never rewritten and the history table works as for a budget set by hand (§7.3): yearly 600 is 50 from the month
it was made, edited to 720 in June it is 60 from June and May stays 50, and the last bill ending writes a zero. `budget_source` is chosen with
`setBudgetSource` (`PATCH /api/subcategories/[id]` with `budgetSource: 'bills' | 'manual'`, a _By bills_ / _By hand_ button on the Categories page): choosing bills
writes the sum at once, choosing by hand **keeps the amount in force**, which is then the person's. **`setBudget` now refuses a subcategory budgeted by its
bills** in a sentence, since a hand-set figure would be overwritten by the next change to a bill; `writeBudget` is the same write without that check, for
`bills.ts` alone. The Budget screen already grouped such rows under _Bills_; selecting one now says it is set by its bills and links to the Bills page in
place of the hand editor. 10 tests on all three databases (the worked example including the payment landing in July only, several bills with a weekly one
and a zero when the last ends, one that runs out, a foreign-currency bill converted and one with no rate, hand-set left alone and refused when by bills,
second person), 4 pure, 1 route test and 1 browser test. Each key test was seen to fail against the code it guards (from next month, no sync on ending,
no sync when the last occurrence runs out, the refusal of a hand-set budget, no sync of an edit).

#### ✅ 6.5 — Loan instalments

**Goal:** a loan that pays itself down. **Design:** §8.3. **Depends on:** 6.3, 4.1.

**Technical:** making a loan offers its instalment as a recurring entry (account, day, mode) and makes a _Loans_ category and the loan's interest
subcategory; each occurrence is an expense of three lines; interest from the yearly rate on what is left by days, or none without a rate (split when
confirming); the last instalment capped; the entry ends with the loan.

**Accepts when:** worked example: 10,000 at 6% with 200 a month gives the expected first three splits to the cent; the final payment leaves exactly
zero; deleting an instalment restores the loan's balance.

**Done as:** `src/recurring/loan-split.ts`, pure: **interest = what is left × the yearly rate × the days since the last instalment (or the loan's start) ÷
365, half to even, in `bigint`**, principal the rest; the **last instalment is capped at what is left, interest included**, so the loan ends at exactly zero;
an instalment that does not cover its interest is all interest and never makes a negative principal. The worked example, 10,000 at 6% with 200 a month from
1 January, posts on 1 February, 1 March and 1 April: **interest 50.96, 45.34, 49.41 and principal 149.04, 154.66, 150.59**, leaving 9,545.71. `loan-entry.ts`
works the split out **when the instalment is posted** from the loan's balance on the day (derived, so a deleted instalment or an extra payment is in the next
one) and the days since the last posting, and makes the entry: an expense of **three lines** (the paying account down, the loan up by the principal, the interest
subcategory up) or, with no interest, a transfer to the loan. `loan.ts` `createInstalments` (**`POST /api/accounts/[id]/instalments`**, `{ from, firstDate, mode }`)
makes the recurring entry for a loan once (monthly from the first day to the loan's end date, `loan_account_id` set; what it stores is who pays and the
loan's instalment, the split is not stored) and makes the **Loans category and the loan's interest subcategory** (reusing a _Loans_ category that is there, the
loan's name in the subcategory's) and names it on the loan. `postOccurrence` hands a loan's entry to `loan-entry.ts`; the **entry ends with the instalment that pays the
loan off**, at once and not only on the next run, and one found already paid off posts nothing and ends; **deleting a loan (before anything was posted) ends its
instalments**. A corrected amount when confirming is the instalment for that day, split the same way. **Screen:** an _Instalments_ section on the loan's own page
(_Pay from_, _First instalment_, _Ask me before each is posted_), which becomes a line about them with a link to Bills. Differences from the plan: the offer is on the loan's
page and not in the add-account dialog (so a loan made earlier can be given instalments too); a split of an instalment by hand when confirming is not offered (the person
edits the posted entry). 10 tests on all three databases (the worked example to the cent, the categories once, the last capped to zero, no rate as a transfer, deleting
an instalment, confirming a corrected amount, already paid off, a deleted loan, second person), 10 pure, 2 route tests and 1 browser test. Each key test was seen to
fail against the code it guards (no cap on the last, the days ignored, the balance ignored, half-up rounding, the entry not ended with the loan, a deleted loan's instalments kept).
