# Epic 8: Reports

## Status

⏳ In progress: 4 of 7 tasks are done.

## Overview

The month and the year against budget, net worth over time, the charts that show them, the month-end review and recap, and the rule-based insights.
Every figure is a pure function over rows, shared by the screens, the recap and the insights.

## Related

[`DESIGN.md`](../../DESIGN.md) §11, §12, §14.5

## Tasks

#### ✅ 8.1 — The month

**Goal:** a month's figures, one computation everywhere. **Design:** §11.1, §11.2. **Depends on:** 5.4, 4.6.

**Technical:** `src/reports/month.ts`, pure: income budgeted and received, spent by category and subcategory against budget, the three savings
figures (actual after jars reads 7.1's contributions once it exists, zero before), the small summaries (cards, people, loans), "not included" notes;
`/reports` with the month list ("In progress", reviewed or not) and a month's detail.

**Accepts when:** a seeded multi-currency month's figures match hand-worked values; loan principal is not spending and loan interest is.

**Done as:** `src/reports/month.ts`. **`buildMonthReport` is pure** over the month's parts (the income figures and the budget figures the income page and the Budget screen already
read, the jar contributions, the accounts with their balances at the month's end, the principal paid on each loan, the rates) and **adds no arithmetic that is not a sum or a
difference of theirs**, so the report agrees with the screens by construction. It holds income budgeted and received; spending by category (`categoriesOf`: each category rolled up in its
own currency from its subcategories, with how far it is over) and subcategory against the budget; **the three savings figures**: _projected_ (budgeted income less budgeted spending), _actual_
(received less spent) and _actual after jars_ (actual less what was earmarked in the jars in the month: the contributions that were made, a skipped one being nothing; 7.2 now exists, so
the plan's "zero before it exists" is not needed); and the small summaries: each **card** (used of its limit), **people** (owed to you and you owe, in the base currency) and **loan** (left to pay at the
month's end, and the principal that came off it in the month). **Loan interest is spent and loan principal is not** with no rule for it: interest is a line on a subcategory and principal is a
line on the loan, so the sum of subcategory lines is spending and a transfer of debt is not in it. What any figure left out for want of a rate is said ("Income: 1 amount in CHF not included"),
never counted as nothing. `loadMonthList` lists the months from the first entry's to the current one (newest first, at most 36) with income received, spent and saved, the current one
**in progress**, in **two reads for the whole range** (`spentBetween` and `receivedBetween`, the month's own queries over any range) and not two for each month. **`/reports`** is the list and
`/reports?month=YYYY-MM` a month's report (income and saving, spending by category with its subcategories, cards, people and loans, links to the Budget row). Whether a month is
reviewed waits for 8.5. A hand-worked month of two currencies (rate 1.25), a loan with interest and principal, money lent, a card and a jar is tested on all three databases: received
3,500, spent 1,270, projected 1,700, actual 2,230, after jars 2,080, the loan 4,850 left and 150 paid, the card 120 of 3,000, 100 owed to you; 7 tests of the month and the list (one for
a book with nothing, one for another person, one for a missing rate), 2 pure, and 1 browser test. Each key test was seen to fail against the code it guards (after-jars ignoring the jars, the
sign of what people owe, the list not splitting by month); one mutant is equivalent and says so: excluding an opening from what was paid off a loan, which a loan's opening, being below nothing, is
already excluded from by the sign.

#### ✅ 8.2 — The year

**Goal:** a year by category and subcategory. **Design:** §11.1. **Depends on:** 8.1.

**Technical:** `?year=` summing the months with each month's own budget (history, 5.2) and rates; a table of months by category.

**Accepts when:** a year with a mid-year budget change totals each month at the budget it had then.

**Done as:** `src/reports/year.ts`. `buildYearReport` is **pure over the twelve month reports** (8.1) and **converts and rounds nothing: it adds the months' figures**, each already at the
budget in force that month (5.2's history) and at the rates of its own days, so a budget of 100 until June and 200 from July is 6 × 100 + 6 × 200 = 1,800 for the year and not 12 × 200,
and 80 euros is 100 dollars in March and 80 in September. A total that would leave a month out (a month with no base figure) is `null` and says nothing, rather than a smaller number.
It holds each month's received, spent and saved; the year's totals (income received and budgeted, spent and budgeted, and the three savings figures summed); and **each category and subcategory by
month** in the category's own currency with the year's spent and budgeted; and what any month left out for want of a rate, with the month. `monthsOfYear` gives the months so far for this
year, all twelve for one that is over and none for one that has not begun. **`/reports?year=YYYY`** shows it (the year in total, month by month with links to each month, and the table of
months by category and subcategory, which scrolls sideways on a phone), and the list of months links the years. A year of two currencies, a budget changed in July, income and savings is tested
on all three databases (6 tests: the 1,800, the conversion by month, the sums and each month's figures, this year so far and a year not begun, another person) and 1 browser test; each key test was
seen to fail against the code it guards (the budget at the last month's amount, the projected figure taken from the actual one). The year runs twelve month reports, which is twelve times the
month's reads and no more; a single pass over a year is for 8.3's net worth, which needs the lines themselves.

#### ✅ 8.3 — Net worth over time

**Goal:** what the person was worth at each month end. **Design:** §11.3. **Depends on:** 8.1, 4.9.

**Technical:** `netWorthAt(date)` from lines and that day's rates, assets and liabilities apart; month ends for a range, computed in one pass over the
lines (not a query per month); shown on Accounts and in Reports.

**Accepts when:** month-end figures match a hand-worked seed including a revaluation and a currency move; a twenty-four-month range reads the lines
once.

**Done as:** `src/reports/net-worth.ts`. **`netWorthSeries` is pure and a single pass:** it is given each account's lines summed for each day (`Movement`), sorts them by day once, and
runs the balances forward through the dates, converting each date's balances at **that date's rates** and keeping what is above nothing as **assets** and what is below as **liabilities**
(negative), which add up to the net worth the Accounts screen shows and are converted account by account the same way (the series' last point is tested equal to `loadOverview`'s total).
`loadNetWorthSeries` reads **the lines of the book once**, grouped by account and day with the account's currency, and the rates once for the range, and returns the month ends of the last N
months (the current month's point is today); `netWorthAt(date)` is the same for one day, and the 24-month series is tested equal to `netWorthAt` on five of its days. A line dated on the day counts
and one dated the day after does not. Nothing is stored: an opening, a new value and an adjustment are lines like the rest, and an account has nothing before its first line. An amount with no
rate is left out and said (the table names the currencies). **Shown** as _Net worth by month end_ (a table of the last twelve) on **Accounts** and **Reports**; a chart of it is 8.4's, and the table stays beside it.
The hand-worked book (a dollar account, 800 euros, an investment revalued, a loan, a euro that falls from 1.25 to 1 dollars) gives 3,500, 4,300 and 4,100 at the end of January, February and March. 3 tests on all three databases (the hand-worked months, the series against one day and the Accounts screen, another person and a book with no base currency) and 6 pure (the dates, the order of the lines, assets and liabilities, a day's own lines, nothing before a first line, a missing rate) and 1 browser test; each key test was seen to fail against the code
it guards (every date at the last day's rates, liabilities counted the wrong way, a day's own lines left out). A test that Accounts still shows its one _Net worth_ region now asks for it by its exact name, since the new
table's name begins the same.

#### 📋 8.4 — Charts

**Goal:** net worth, spending and budget trends, drawn. **Design:** §11.3, §14.5. **Depends on:** 8.3; the charts in `@sovereignfs/ui` (a task in
`sovereign`, raised first).

**Technical:** propose and build in `sovereign`'s design system a line/area chart and a bar chart (SVG, `--sv-*` colours, a data table beside each,
keyboard and screen-reader readable, no external library loaded at run time); release; then pin the release here and draw net worth by month,
spending by category for a month, and budgeted vs spent by month for a year.

**Accepts when:** each chart renders in light and dark and at a phone's width, and its table holds the same numbers.

#### ✅ 8.5 — The month-end review

**Goal:** close a month on purpose. **Design:** §11.4. **Depends on:** 8.1.

**Technical:** `month_review`; "Needs review" for a past month with no row; a banner on Overview for the most recent; "Adjust budgets" opens the
budget for the next month; "Mark reviewed" idempotent and undoable.

**Accepts when:** marking a month reviewed twice leaves one row; the banner goes when it is reviewed and returns when undone.

**Done as:** one book table, **`month_review`** (migration `0010`, both dialects; `(book_id, month)` is the primary key, so **marking twice leaves one row**; in `BOOK_TABLES` and seeded in
`people.test.ts`). `src/reports/review.ts`: **`reviewStatus`** (pure: the current month and any after are _in progress_, a past month with a row is _reviewed_, any other past month _needs review_),
`pastMonths` and **`monthNeedingReview`** (the most recent past month, from the month of the first entry, without a row: the banner's month, which moves back as months are reviewed and
returns when one is undone), `reviewedMonths`, and `setReviewed(month, reviewed, today)`: **only a month that is over is reviewed** (by the book's own calendar), a month not over or not a month
is a sentence, marking and undoing are idempotent (an insert that does nothing on a repeat, a delete of nothing), and a book that is not the caller's is not found. **`POST /api/reviews`**
(`{ month, reviewed }`) and `GET`, nothing in a request naming whose book, with a test as a second person. **Screens:** a _Review_ section on a month's report (_Mark reviewed_, _Undo review_,
and **Adjust budgets for the next month**, a link to the Budget at that month, where a change writes history rows from it), a _Review_ column in the list of months (_In progress_, _Needs review_,
_Reviewed_), and a **banner on Overview** ("2026-10 needs its review") linking to the month. 7 tests on all three databases (marking once however many times and undoing, a month not over, the book's
own, the banner moving and returning, another person's), 3 pure, 2 on the routes and 1 browser test; each key test was seen to fail against the code it guards (a month in progress reviewed, the
banner for the oldest month, undo doing nothing, the read without the permission). The recap (8.6), which reads the same figures, waits for the bell (10.1).

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
