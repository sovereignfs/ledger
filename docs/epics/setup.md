# Epic 9: Setup and Overview

## Status

📋 Planned.

## Overview

The first minute, the page a person returns to, and the book's settings.

## Related

[`DESIGN.md`](../../DESIGN.md) §14.3, §15

## Tasks

#### 📋 9.1 — The setup wizard

**Goal:** from nothing to a usable budget in a minute. **Design:** §15.3. **Depends on:** 4.1, 5.3.

**Technical:** `/setup`, full-bleed, a `StepStrip`: base currency (from the locale), first account and its opening balance, primary income, first
categories as chips with editable amounts (none made without a tap); each step a real write; time zone from the browser; `setup_done_at`; `/` goes to
setup until done.

**Accepts when:** a fresh account reaches Overview in four steps; refreshing mid-way loses nothing already entered; going back and forward makes no
duplicate.

#### 📋 9.2 — Overview

**Goal:** where things stand, at a glance. **Design:** §14.3. **Depends on:** 9.1, 5.4.

**Technical:** this month (income received, spent, projected and actual saved), net worth, jars total, budget rows closest to or over budget, recent
transactions; the setup checklist (more accounts, cards and loans, secondary income, bills, jars, people) until done or dismissed, then a "Finish
setup" link. Upcoming bills (6.3), insights (8.7) and the review banner (8.5) join as those land.

**Accepts when:** a new book shows the checklist and Add works from it; a populated book shows figures equal to the month's report.

#### 📋 9.3 — The book's settings

**Goal:** everything setup chose, changeable. **Design:** §15.1, §15.2. **Depends on:** 2.6, 9.1.

**Technical:** Settings sections Book (name, base currency, time zone, first day of week, number locale), Currencies, Income sources, Categories
(order, archive, delete), Payees, Notifications (recap on/off).

**Accepts when:** changing the base currency re-reports every figure in the new one with nothing stored changed; changing the time zone moves when
the next recap and posting happen.
