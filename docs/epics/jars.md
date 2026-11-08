# Epic 7: Saving jars

## Status

📋 Planned.

## Overview

Money set aside inside a real account, contributed to each month, and spent from when the time comes.

## Related

[`DESIGN.md`](../../DESIGN.md) §10

## Tasks

#### 📋 7.1 — Jars and movements

**Goal:** earmarks with a balance. **Design:** §10.1, §10.2. **Depends on:** 4.1, 5.2.

**Technical:** `jar`, `jar_movement`; make a jar in an asset account with a target and a monthly contribution (history through 5.2); earmark and
release by hand; an account shows "in jars" and "free"; never past the account's balance, never below zero (checked in the write's statement); the
Saving group of the budget screen; moving a jar to another account.

**Accepts when:** an earmark that would exceed the account's free money is refused; two earmarks racing cannot together exceed it.

#### 📋 7.2 — Monthly contributions

**Goal:** saving without thinking. **Design:** §10.2. **Depends on:** 7.1, 6.2.

**Technical:** in the recurring job, on the 1st in the book's zone, each jar's contribution earmarked once (unique `(jar_id, month)`), skipped with a
note on Overview if it does not fit; an account over-earmarked by later spending says so and offers which jar to release (§22 of the design).

**Accepts when:** a jar of 150 a month gains 150 on the 1st once; a contribution that does not fit is skipped and reported, not partly made.

#### 📋 7.3 — Spending from a jar

**Goal:** booking the trip against the Travel jar. **Design:** §10.2, §14.4. **Depends on:** 7.1, 4.3.

**Technical:** "From a jar" in the add dialog for an expense from an account with jars, showing each jar's balance; the expense and a `spend`
movement in one transaction; deleting or editing the expense updates the movement.

**Accepts when:** a 400 flight from the Travel jar releases 400 and counts as spending in its subcategory; more than the jar holds is refused before
submitting; deleting the expense restores the jar.
