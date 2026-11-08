# Epic 8: Reports

## Status

📋 Planned.

## Overview

The month and the year against budget, net worth over time, the charts that show them, the month-end review and recap, and the rule-based insights.
Every figure is a pure function over rows, shared by the screens, the recap and the insights.

## Related

[`DESIGN.md`](../../DESIGN.md) §11, §12, §14.5

## Tasks

#### 📋 8.1 — The month

**Goal:** a month's figures, one computation everywhere. **Design:** §11.1, §11.2. **Depends on:** 5.4, 4.6.

**Technical:** `src/reports/month.ts`, pure: income budgeted and received, spent by category and subcategory against budget, the three savings
figures (actual after jars reads 7.1's contributions once it exists, zero before), the small summaries (cards, people, loans), "not included" notes;
`/reports` with the month list ("In progress", reviewed or not) and a month's detail.

**Accepts when:** a seeded multi-currency month's figures match hand-worked values; loan principal is not spending and loan interest is.

#### 📋 8.2 — The year

**Goal:** a year by category and subcategory. **Design:** §11.1. **Depends on:** 8.1.

**Technical:** `?year=` summing the months with each month's own budget (history, 5.2) and rates; a table of months by category.

**Accepts when:** a year with a mid-year budget change totals each month at the budget it had then.

#### 📋 8.3 — Net worth over time

**Goal:** what the person was worth at each month end. **Design:** §11.3. **Depends on:** 8.1, 4.9.

**Technical:** `netWorthAt(date)` from lines and that day's rates, assets and liabilities apart; month ends for a range, computed in one pass over the
lines (not a query per month); shown on Accounts and in Reports.

**Accepts when:** month-end figures match a hand-worked seed including a revaluation and a currency move; a twenty-four-month range reads the lines
once.

#### 📋 8.4 — Charts

**Goal:** net worth, spending and budget trends, drawn. **Design:** §11.3, §14.5. **Depends on:** 8.3; the charts in `@sovereignfs/ui` (a task in
`sovereign`, raised first).

**Technical:** propose and build in `sovereign`'s design system a line/area chart and a bar chart (SVG, `--sv-*` colours, a data table beside each,
keyboard and screen-reader readable, no external library loaded at run time); release; then pin the release here and draw net worth by month,
spending by category for a month, and budgeted vs spent by month for a year.

**Accepts when:** each chart renders in light and dark and at a phone's width, and its table holds the same numbers.

#### 📋 8.5 — The month-end review

**Goal:** close a month on purpose. **Design:** §11.4. **Depends on:** 8.1.

**Technical:** `month_review`; "Needs review" for a past month with no row; a banner on Overview for the most recent; "Adjust budgets" opens the
budget for the next month; "Mark reviewed" idempotent and undoable.

**Accepts when:** marking a month reviewed twice leaves one row; the banner goes when it is reviewed and returns when undone.

#### 📋 8.6 — The recap

**Goal:** last month, delivered on the 1st. **Design:** §11.5, §13.4. **Depends on:** 8.1, 8.7, 10.1.

**Technical:** the `recap` job: for each book with the recap on, on the 1st in its zone, claim `(book, recap, month)` in `book_job_mark`, then send the
previous month's figures, the three categories most over budget and any insight, with an absolute link; through core's bell and email when granted,
otherwise the app's SMTP, otherwise nothing; amounts in the base currency.

**Accepts when:** the job run twice on the 1st, and from two processes, sends one recap; with neither core nor SMTP it sends nothing and logs nothing
of the figures.

#### 📋 8.7 — Insights

**Goal:** tips worth reading. **Design:** §12. **Depends on:** 8.1.

**Technical:** `src/insights/`, pure: over budget two completed months running; an expense over three times its subcategory's six-month median with
at least five to compare; at most three on Overview, all in a month's report, each with a link.

**Accepts when:** a single seeded month produces no insight; a second over-budget month produces exactly the expected one; each rule's test is seen
to fail with the rule switched off.
