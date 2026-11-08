# Epic 6: Recurring entries

## Status

📋 Planned.

## Overview

Bills and income that make their own transactions, each posting by itself or waiting to be confirmed; bills that set their subcategory's budget; a
loan's instalment split into principal and interest.

## Related

[`DESIGN.md`](../../DESIGN.md) §8, §7.2 · Tusk's `src/recurrence.ts`

## Tasks

#### 📋 6.1 — The rule

**Goal:** the next occurrence, right in every month and zone. **Design:** §8.1. **Depends on:** 1.2.

**Technical:** Tusk's `src/recurrence.ts` copied and trimmed to every N days, weeks, months or years from an anchor, until an end; the 31st falls on
the last day of a shorter month; `monthlyEquivalent(rule, amount)` (§8.4), pure. Tests under three time zones.

**Accepts when:** worked examples (31 Jan monthly, 29 Feb yearly, every 2 weeks across a DST change) give the expected dates.

#### 📋 6.2 — Recurring entries and auto-posting

**Goal:** a template that posts itself. **Design:** §8.2. **Depends on:** 6.1, 4.3.

**Technical:** `recurring`; make one from a transaction ("Repeat…") or from scratch; edit future occurrences, end; the `post-recurring` job each hour:
for each book, the entries whose `next_date` is today or past in the book's zone and mode `auto`, posted through 4.2's path with
`(recurring_id, occurrence_date)` unique, then `next_date` moved on, catching up missed occurrences.

**Accepts when:** a monthly rent posts on the 1st once, even with the job run twice and from two processes; a server down for three days posts the
three missed occurrences once each.

#### 📋 6.3 — Upcoming, and confirming

**Goal:** variable bills checked before they are posted. **Design:** §8.2. **Depends on:** 6.2.

**Technical:** mode `confirm`: due occurrences listed as upcoming (Overview, the transactions list), each to post as is, edit and post, or skip
(`recurring_skip`); overdue ones stay until handled.

**Accepts when:** an electricity bill due today shows as upcoming, is posted with a corrected amount, and does not appear again; a skipped one is
gone and the next is scheduled.

#### 📋 6.4 — Bills in the budget

**Goal:** a subcategory budgeted by its recurring entries. **Design:** §7.2, §8.4. **Depends on:** 6.2, 5.2.

**Technical:** a subcategory with `budget_source = bills` takes its budget from its recurring entries' monthly equivalents, converted at the rate in
force; making, editing or ending one writes the subcategory's `budget_amount` from the current month.

**Accepts when:** a yearly 600 insurance budgets 50 a month and its payment lands in the month paid; editing it to 720 from June changes June on and
not May.

#### 📋 6.5 — Loan instalments

**Goal:** a loan that pays itself down. **Design:** §8.3. **Depends on:** 6.3, 4.1.

**Technical:** making a loan offers its instalment as a recurring entry (account, day, mode) and makes a _Loans_ category and the loan's interest
subcategory; each occurrence is an expense of three lines; interest from the yearly rate on what is left by days, or none without a rate (split when
confirming); the last instalment capped; the entry ends with the loan.

**Accepts when:** worked example: 10,000 at 6% with 200 a month gives the expected first three splits to the cent; the final payment leaves exactly
zero; deleting an instalment restores the loan's balance.
