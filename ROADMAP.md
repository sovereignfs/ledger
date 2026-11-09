# Roadmap

The order of work. **This file tracks progress; it does not define behaviour.** [`DESIGN.md`](DESIGN.md) says what Ledger does, and where it disagrees with this file, this file is stale and should be corrected. The detail of every task, with its technical notes and what makes it done, is in [`docs/epics/`](docs/epics/). How a task is run is in [`AGENTS.md`](AGENTS.md).

State as of 2026-11-09: **Milestones A, B and C are done**: the foundation (1.1 to 1.10); sign-in, the book, the front address, deleting a person, Settings, and money and currencies (2.1, 3.1, 2.2, 2.5, 2.6, 3.2); and the ledger, which is exchange rates and conversion (3.3, 3.4), the one write path for transactions (4.2), money accounts (4.1), categories (5.1), the add dialog, splits, payees and transfers (4.3 to 4.6), the transactions list (4.7), reconciling (4.8) and revaluation (4.9). **Milestone D is done** too: budget history (5.2), income (5.3), the budget screen (5.4), the setup wizard (9.1) and Overview (9.2). **Milestone E is done** too: recurring entries (6.1 to 6.5: the rule, posting, upcoming, bills in the budget, a loan's instalments), jars (7.1 to 7.3: earmarks, monthly contributions, spending from a jar) and the development seed (12.1). **Milestone F is done but for its charts**: the month (8.1), the year (8.2), net worth over time (8.3), the month-end review (8.5) and insights (8.7); the charts (8.4) wait on the design system, which has none, and the recap (8.6) is in Milestone G with the bell. The PWA (1.11) waits in Milestone G, and sign-in through core (2.3, 2.4) in Milestone G too. The developer assigns each task; the first row not done, with its dependencies met, is what the order recommends.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision · ➖ Superseded_

_Priority:_ **P0** nothing else can stand without it · **P1** the product · **P2** needed before the first release · **P3** can follow the first release if it must

## How this is ordered

Tusk's order (building-an-app §14): conventions, configuration, database, sign-in, the shell, then the product, then the image and the release. Within the product:

1. **The book and the permission first** (3.1), so that no table is written without `book_id` in its statement.
2. **The ledger before the budget** (C), because spent, income received, jars and net worth are all read from lines. Exchange rates come with it, since the first account in a second currency needs them.
3. **The budget and the first minute** (D) make it usable by one person.
4. **Recurring entries and jars** (E) make it a daily driver; the seed lands once there is something worth seeding.
5. **Reports** (F) read everything before them. Charts wait on the design system.
6. **The suite and portability** (G), then the release (H). Sign-in through core is P0 but can come late, as Tusk's did: nothing before it depends on it.

## Phase 1 — the MVP

### Milestone A — Foundation

The repository can hold the app. Nothing a person would notice. **Done when** an empty database boots on all three forms from the image, and CI proves it.

| #   | ID                               | Task                             | Priority | Depends on | Status |
| --- | -------------------------------- | -------------------------------- | -------- | ---------- | ------ |
| 1   | [1.1](docs/epics/foundation.md)  | Repository conventions           | P0       | —          | ✅     |
| 2   | [1.2](docs/epics/foundation.md)  | Format, lint and test tooling    | P0       | 1.1        | ✅     |
| 3   | [1.3](docs/epics/foundation.md)  | Continuous integration           | P0       | 1.2        | ✅     |
| 4   | [1.4](docs/epics/foundation.md)  | Configuration and start-up       | P0       | 1.2        | ✅     |
| 5   | [1.5](docs/epics/foundation.md)  | The database layer               | P0       | 1.4        | ✅     |
| 6   | [1.8](docs/epics/foundation.md)  | Design system boundary and shell | P0       | 1.2        | ✅     |
| 7   | [1.7](docs/epics/foundation.md)  | Security headers                 | P0       | 1.4        | ✅     |
| 8   | [1.6](docs/epics/foundation.md)  | The job runner                   | P0       | 1.5        | ✅     |
| 9   | [1.9](docs/epics/foundation.md)  | Browser tests                    | P0       | 1.5        | ✅     |
| 10  | [1.10](docs/epics/foundation.md) | The image and deployment setups  | P0       | 1.5, 1.6   | ✅     |

### Milestone B — Sign-in and the book

One person signs in to a book of their own, and every statement carries the permission. **Done when** a second person can reach nothing of the first, and deleting a person leaves nothing.

| #   | ID                            | Task                             | Priority | Depends on | Status |
| --- | ----------------------------- | -------------------------------- | -------- | ---------- | ------ |
| 11  | [2.1](docs/epics/accounts.md) | Local sign-in                    | P0       | 1.5, 1.8   | ✅     |
| 12  | [3.1](docs/epics/money.md)    | Books and access                 | P0       | 2.1        | ✅     |
| 13  | [2.2](docs/epics/accounts.md) | Landing page and the address `/` | P1       | 2.1        | ✅     |
| 14  | [2.5](docs/epics/accounts.md) | Deleting a person                | P0       | 3.1        | ✅     |
| 15  | [2.6](docs/epics/accounts.md) | Settings                         | P1       | 2.1, 1.8   | ✅     |
| 16  | [3.2](docs/epics/money.md)    | Money and currencies             | P0       | 1.5        | ✅     |

### Milestone C — The ledger

Money moves between accounts that balance. **Done when** a person can open accounts, log expenses, income, splits and transfers, find them in the list, and reconcile an account to a statement, in more than one currency.

| #   | ID                          | Task                         | Priority | Depends on    | Status |
| --- | --------------------------- | ---------------------------- | -------- | ------------- | ------ |
| 17  | [3.3](docs/epics/money.md)  | Exchange rates               | P0       | 1.6, 3.2      | ✅     |
| 18  | [3.4](docs/epics/money.md)  | Conversion                   | P0       | 3.3           | ✅     |
| 19  | [4.2](docs/epics/ledger.md) | Transactions and lines       | P0       | 3.1, 3.2      | ✅     |
| 20  | [4.1](docs/epics/ledger.md) | Money accounts               | P1       | 3.1, 3.2, 4.2 | ✅     |
| 21  | [5.1](docs/epics/budget.md) | Categories and subcategories | P1       | 3.1, 3.2      | ✅     |
| 22  | [4.3](docs/epics/ledger.md) | The add dialog               | P1       | 4.1, 5.1      | ✅     |
| 23  | [4.4](docs/epics/ledger.md) | Splits                       | P1       | 4.3           | ✅     |
| 24  | [4.5](docs/epics/ledger.md) | Payees                       | P1       | 4.3           | ✅     |
| 25  | [4.6](docs/epics/ledger.md) | Transfers                    | P1       | 4.3           | ✅     |
| 26  | [4.7](docs/epics/ledger.md) | The transactions list        | P1       | 4.4, 4.5, 4.6 | ✅     |
| 27  | [4.8](docs/epics/ledger.md) | Status and reconciling       | P1       | 4.7           | ✅     |
| 28  | [4.9](docs/epics/ledger.md) | Revaluation                  | P1       | 4.1           | ✅     |

### Milestone D — The budget, and first use

A budget that keeps its history, and the first minute. **Done when** a fresh person goes from setup to a month of budgeted vs spent, and changing a budget leaves past months as they were.

| #   | ID                          | Task                               | Priority | Depends on    | Status |
| --- | --------------------------- | ---------------------------------- | -------- | ------------- | ------ |
| 29  | [5.2](docs/epics/budget.md) | Budget history                     | P1       | 5.1           | ✅     |
| 30  | [5.3](docs/epics/budget.md) | Income sources and income received | P1       | 5.2, 4.3      | ✅     |
| 31  | [5.4](docs/epics/budget.md) | The budget screen                  | P1       | 5.2, 5.3, 4.4 | ✅     |
| 32  | [9.1](docs/epics/setup.md)  | The setup wizard                   | P1       | 4.1, 5.3      | ✅     |
| 33  | [9.2](docs/epics/setup.md)  | Overview                           | P1       | 9.1, 5.4      | ✅     |

### Milestone E — Recurring entries and jars

What makes it a daily driver: bills that post themselves, loans that pay down, money set aside. **Done when** a seeded year of rent, a variable bill, a loan and a jar behave as `DESIGN.md` §8 and §10 say.

| #   | ID                             | Task                               | Priority | Depends on | Status |
| --- | ------------------------------ | ---------------------------------- | -------- | ---------- | ------ |
| 34  | [6.1](docs/epics/recurring.md) | The rule                           | P1       | 1.2        | ✅     |
| 35  | [6.2](docs/epics/recurring.md) | Recurring entries and auto-posting | P1       | 6.1, 4.3   | ✅     |
| 36  | [6.3](docs/epics/recurring.md) | Upcoming, and confirming           | P1       | 6.2        | ✅     |
| 37  | [6.4](docs/epics/recurring.md) | Bills in the budget                | P1       | 6.2, 5.2   | ✅     |
| 38  | [6.5](docs/epics/recurring.md) | Loan instalments                   | P1       | 6.3, 4.1   | ✅     |
| 39  | [7.1](docs/epics/jars.md)      | Jars and movements                 | P1       | 4.1, 5.2   | ✅     |
| 40  | [7.2](docs/epics/jars.md)      | Monthly contributions              | P1       | 7.1, 6.2   | ✅     |
| 41  | [7.3](docs/epics/jars.md)      | Spending from a jar                | P1       | 7.1, 4.3   | ✅     |
| 42  | [12.1](docs/epics/release.md)  | Development seed                   | P1       | 6.5, 7.2   | ✅     |

### Milestone F — Reports

Looking back. **Done when** month, year and net worth figures match a hand-worked seed, with charts, the review and insights.

| #   | ID                           | Task                 | Priority | Depends on                       | Status |
| --- | ---------------------------- | -------------------- | -------- | -------------------------------- | ------ |
| 43  | [8.1](docs/epics/reports.md) | The month            | P1       | 5.4, 4.6                         | ✅     |
| 44  | [8.2](docs/epics/reports.md) | The year             | P1       | 8.1                              | ✅     |
| 45  | [8.3](docs/epics/reports.md) | Net worth over time  | P1       | 8.1, 4.9                         | ✅     |
| 46  | [8.5](docs/epics/reports.md) | The month-end review | P1       | 8.1                              | ✅     |
| 47  | [8.7](docs/epics/reports.md) | Insights             | P1       | 8.1                              | ✅     |
| 48  | [8.4](docs/epics/reports.md) | Charts               | P1       | 8.3; charts in `@sovereignfs/ui` | 🚧     |

### Milestone G — The suite, and the person's data

Part of the suite, and a person can leave. **Done when** it signs in through core, honours both notices, sends the recap through the bell, and a book round-trips through a file.

| #   | ID                                | Task                     | Priority | Depends on     | Status |
| --- | --------------------------------- | ------------------------ | -------- | -------------- | ------ |
| 49  | [2.3](docs/epics/accounts.md)     | Sign-in through core     | P0       | 2.1            | 📋     |
| 50  | [2.4](docs/epics/accounts.md)     | Core's notices           | P0       | 2.3, 2.5       | 📋     |
| 51  | [10.1](docs/epics/suite.md)       | Bell, email and activity | P2       | 2.3, 1.6       | 📋     |
| 52  | [8.6](docs/epics/reports.md)      | The recap                | P2       | 8.1, 8.7, 10.1 | 📋     |
| 53  | [9.3](docs/epics/setup.md)        | The book's settings      | P2       | 2.6, 9.1       | ✅     |
| 54  | [11.1](docs/epics/portability.md) | Export                   | P2       | 7.3, 6.5, 8.5  | ✅     |
| 55  | [11.2](docs/epics/portability.md) | Import                   | P2       | 11.1           | ✅     |
| 56  | [1.11](docs/epics/foundation.md)  | The PWA                  | P2       | 1.8            | 📋     |

### Milestone H — Release

**Done when** 0.1.0 is published and hosted on the live instance.

| #   | ID                            | Task                   | Priority | Depends on | Status |
| --- | ----------------------------- | ---------------------- | -------- | ---------- | ------ |
| 57  | [12.3](docs/epics/release.md) | Documents              | P2       | 1.10       | 📋     |
| 58  | [12.2](docs/epics/release.md) | Security review        | P2       | 11.2, 8.6  | 📋     |
| 59  | [12.4](docs/epics/release.md) | Release 0.1.0          | P2       | 12.2, 12.3 | 📋     |
| 60  | [12.5](docs/epics/release.md) | Hosting on an instance | P2       | 12.4       | 📋     |

## Phase 2 — candidates

None committed (`DESIGN.md` §2): shared household books, CSV import, receipts, crypto rates, budget rollover, the phone's own screens, AI insights.
