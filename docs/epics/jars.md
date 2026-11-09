# Epic 7: Saving jars

## Status

✅ Done: 3 of 3 tasks.

## Overview

Money set aside inside a real account, contributed to each month, and spent from when the time comes.

## Related

[`DESIGN.md`](../../DESIGN.md) §10

## Tasks

#### ✅ 7.1 — Jars and movements

**Goal:** earmarks with a balance. **Design:** §10.1, §10.2. **Depends on:** 4.1, 5.2.

**Technical:** `jar`, `jar_movement`; make a jar in an asset account with a target and a monthly contribution (history through 5.2); earmark and
release by hand; an account shows "in jars" and "free"; never past the account's balance, never below zero (checked in the write's statement); the
Saving group of the budget screen; moving a jar to another account.

**Accepts when:** an earmark that would exceed the account's free money is refused; two earmarks racing cannot together exceed it.

**Done as:** two book tables, `jar` and `jar_movement` (migration `0009`, both dialects, both in `BOOK_TABLES` and seeded in `people.test.ts`), with a unique
index on `(jar_id, month)` that 7.2 uses for its once-a-month contribution. `src/jars/jars.ts`: `createJar` (in a bank account, cash, savings or a deposit; a
name not already a live jar's in it; a target more than nothing; a monthly contribution written to the budget history as a row of kind `jar` from the
book's current month, so `TARGET_KINDS` gained `jar`), `updateJar`, `moveMoney` (earmark or release by hand), `setJarArchived` (only when empty),
`moveJar` (to an account of the same currency that holds money, **when what the jar holds is free there**, which is a release from one and an earmark in
the other) and `earmarkedByAccount` / `accountFigures` (what an account holds, what is in jars, what is free, and _over-earmarked_ once spending took it below).
**The rule is in the statement:** `insertMovement` first updates the account's row, which in PostgreSQL waits for any other earmark in the account and in
SQLite is a write that serializes, and then writes the movement from a `SELECT` whose condition is that the account's balance on the day less what its jars
hold is at least the amount (an earmark) or that the jar holds at least the amount (a release); nothing is checked first and written after. The race test
makes six earmarks of 30,000 at once in an account with 100,000 free and exactly three succeed, on all three databases. **A balance is derived, never
written:** a jar's balance is the sum of its movements. Routes `GET/POST /api/jars`, `PATCH /api/jars/[id]` (name, target, archive, move) and
`POST /api/jars/[id]/movements` (`{ direction, amount, date? }`), another person's a 404 with nothing in it. **Screens:** a _Jars_ section on a savings, bank, cash or
deposit account's page (add a jar with a target, earmark, release, archive, and the monthly contribution through the budget editor, from this month or next),
_In jars_ and _Free_ in the account's summary, and the **Saving group of the Budget** (each jar with its contribution in force for the month, balance and
progress, linking to its account; contributions are not spending and are not in the totals). A bug the tests found: an `inBook` call whose alias was `m` inside a
query that also aliased the movements `m` matched any member of any book; the movements are `v` there, and the aliases `inBook` uses are not reused. 12 data-layer tests on all
three databases, 5 route tests (second person), 5 pure and 2 browser tests; each key test was seen to fail against the code it guards (the free check, the
release check, archiving a jar that holds money, moving without room, an earmark that ignores the other jars). Left to 7.2 and 7.3: the monthly contribution
job and the Overview note, and spending from a jar.

#### ✅ 7.2 — Monthly contributions

**Goal:** saving without thinking. **Design:** §10.2. **Depends on:** 7.1, 6.2.

**Technical:** in the recurring job, on the 1st in the book's zone, each jar's contribution earmarked once (unique `(jar_id, month)`), skipped with a
note on Overview if it does not fit; an account over-earmarked by later spending says so and offers which jar to release (§22 of the design).

**Accepts when:** a jar of 150 a month gains 150 on the 1st once; a contribution that does not fit is skipped and reported, not partly made.

**Done as:** its own job, **`contribute-jars`** (`src/jars/job.ts`, hourly and at start, in `jobsFor`), and not a branch of `post-recurring`, since it shares nothing
with it but the owner lookup. `contributeDue` (`src/jars/contributions.ts`) takes each live jar, works out **the book's own month** and, for a jar made before it,
**the contribution in force for the month** from the budget history (§7.3), and writes it through 7.1's `insertMovement` (kind `contribution`, the month set) so the rule of 7.1
decides whether it fits, in the statement. **Once a month** is `(jar_id, month)` unique: a job run twice or by three processes at once makes one movement (the test
runs three at once on all three databases), a second writer losing to the key and finding the movement there. **Skipped, not partly made:** an earmark that does not fit
is refused whole, and **a movement of nothing marks the month as skipped**, so it is not tried again every hour for the rest of the month and Overview can say so; the
next month is tried afresh. A jar made this month starts next month. The month is reached on any day of it, not only the 1st: a server that was down on the 1st makes
it as soon as it is up, dated that day. **Overview** has a _Jars_ section when there are jars (`src/jars/notes.ts`): what they hold in the base currency, with what
was left out for want of a rate said, and two notes that link to the account, **a contribution skipped** ("…was not set aside, because there was not enough free in …")
and **an account over-earmarked** ("… holds … less than its jars. Release some from a jar."), which is how the design's _ask which jar to release_ is answered
(the design's open question, §22: the person is asked and nothing is released automatically). 11 tests on all three databases (the once, three at once, a skip and its marker,
room again the next month, a new jar, the contribution in force and its history, an archived jar, Kiritimati's calendar) and 2 pure, and 1 browser test. Each key test was seen
to fail against the code it guards (no marker on a skip, a jar made this month contributing, a later month's contribution used); two mutants are equivalent and say
so: the archived-jar filter and the already-made check are each backed up by a second guard (the lock refuses an archived jar, the unique key refuses a second month).

#### ✅ 7.3 — Spending from a jar

**Goal:** booking the trip against the Travel jar. **Design:** §10.2, §14.4. **Depends on:** 7.1, 4.3.

**Technical:** "From a jar" in the add dialog for an expense from an account with jars, showing each jar's balance; the expense and a `spend`
movement in one transaction; deleting or editing the expense updates the movement.

**Accepts when:** a 400 flight from the Travel jar releases 400 and counts as spending in its subcategory; more than the jar holds is refused before
submitting; deleting the expense restores the jar.

**Done as:** `TxnInput.fromJar` (a jar's id, or `null` to take it off; `undefined` on a change keeps it) and `src/jars/spend.ts`. **The expense and its `spend`
movement are one transaction** through the one write path: `insertTransaction` writes the movement after the lines (a negative movement pointing at the entry,
for the amount the paying account lost), under 7.1's rule that **a jar cannot go below zero**, a condition of the statement that writes it, and refuses a jar
that is not in the account that paid, money back, and any entry that is not an expense, in sentences; a jar that is another person's, or not there, is not found.
`updateTransaction` gives the old movement back first and writes it again for the new lines, so an entry changed to the full amount the jar held is allowed, one that
is too much is refused with the jar as it was, and `undefined` keeps the jar and follows the amount. `deleteTransaction` and `bulkDelete` delete the movement with the
entry, so the jar holds what it did. An account with a jar in it is not deleted (`has_entries`; archive it). **The add dialog** offers _From a jar_ for an expense that
is not money back, from an account that has jars, each with what it holds (what this entry took counts when it is changed); more than the jar holds is **refused
before it is sent** (`jarProblem`, pure, in `compose.ts`, shared with the server's sentence by the same figures), and changing the account or the kind drops the jar.
`getEntry` says the jar an entry was paid from, and the entry options list the jars with their balances. Tests: 7 on all three databases (the 400 flight and its
spending and the account's free money unchanged, too much refused with nothing written, a jar of another account or another person or money back, deleting one by one and in bulk, a change of
amount, jar and none, the options, the request read as hostile input), 1 on the routes as a second person, 6 pure and 1 browser test. Each key test was seen to fail against
the code it guards (delete and bulk delete keeping the movement, a change leaving it, a jar of another account, the given-back amount not counted before submitting).
