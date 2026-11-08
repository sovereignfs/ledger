# Epics

A domain-first map of the work. An epic groups the tasks of one domain. [`ROADMAP.md`](../../ROADMAP.md) is the same tasks in the order they are
built, with their priority and status. [`DESIGN.md`](../../DESIGN.md) is what they build; where a task and the design disagree, the design wins and
the task is corrected.

## Conventions

- **Task IDs are permanent:** `<epic>.<n>`, for example `4.3`. Use them in dependency lists and cross-references. They never appear in branch names,
  commit messages or PR titles, and an ID is never reused, even for a task that was superseded.
- **One task, one branch, one draft PR.** A task is done when its "Accepts when" holds and its PR is merged.
- **Every task** has a Goal, a Design reference, what it Depends on, Technical detail, and Accepts when. Once done it gains **Done as**: how it was
  done, where, and what was left out.
- **On completion,** the task's heading here and its row in `ROADMAP.md` are marked ✅ in the same PR, and a change in behaviour adds a line to
  `CHANGELOG.md`.
- **Every task holds these without saying so:** a data-layer test passes on sqld, a `file:` database and PostgreSQL; a new route or server action is
  in `src/access/routes.ts` with a test calling it as a second person (once 3.1 is in); a new table is handled by `People.deletePerson` (once 2.5 is
  in) and by export and import (once 11.1 is in); a write keeps the ledger's invariants (once 4.2 is in); a screen works with a keyboard, in light and
  dark, and at a phone's width; no amount, name, payee or note reaches a log; a safeguard's test was seen to fail with it switched off.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision · ➖ Superseded_

## Epics

| #   | Epic                                | What it holds                                                                                              | Tasks |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----- |
| 1   | [Foundation](foundation.md)         | Tooling, CI, configuration, the database, jobs, the shell, the image, the PWA                              | 11    |
| 2   | [Accounts and sign-in](accounts.md) | Local and Sovereign sign-in, notices, deleting a person, the landing page, Settings                        | 6     |
| 3   | [Books and money](money.md)         | Books and access, money and currencies, exchange rates, conversion                                         | 4     |
| 4   | [The ledger](ledger.md)             | Money accounts, transactions and lines, the add dialog, splits, payees, the list, reconciling, revaluation | 9     |
| 5   | [The budget](budget.md)             | Categories, budget history, income sources, the budget screen                                              | 4     |
| 6   | [Recurring entries](recurring.md)   | The rule, posting, confirming, bills in the budget, loan instalments                                       | 5     |
| 7   | [Saving jars](jars.md)              | Jars and movements, monthly contributions, spending from a jar                                             | 3     |
| 8   | [Reports](reports.md)               | Month and year, net worth over time, charts, the review, the recap, insights                               | 7     |
| 9   | [Setup and Overview](setup.md)      | The wizard, Overview, Settings' sections                                                                   | 3     |
| 10  | [The suite](suite.md)               | Core's bell, email and activity                                                                            | 1     |
| 11  | [Portability](portability.md)       | Export and import                                                                                          | 2     |
| 12  | [Release](release.md)               | Seed, security review, documents, the first release, hosting                                               | 5     |
