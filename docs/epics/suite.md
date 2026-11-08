# Epic 10: The suite

## Status

📋 Planned.

## Overview

What Ledger uses of a Sovereign instance beyond sign-in: the bell, email and the activity log, each degrading when core is absent or older.

## Related

[`DESIGN.md`](../../DESIGN.md) §13.3, §13.4 · `sovereign`'s `docs/using-the-sdk.md` §4

## Tasks

#### 📋 10.1 — Bell, email and activity

**Goal:** the app's notices where the person already looks. **Design:** §13.4. **Depends on:** 2.3, 1.6.

**Technical:** `src/sovereign/core.ts` wrapping `sv.app.notifications.send`, `sv.app.email.sendToUser` and `sv.app.activity.log` with a `key` per send;
`NotSupportedError` and no core send nothing; the daily bell for upcoming bills (count, once per book and day), a newly firing insight (once per
insight and month), activity lines for export, import and delete everything; the manifest's `core` floor checked against core's changelog for these
calls. Tested against `createFakeCore`.

**Accepts when:** with the scopes granted each notice arrives once per key; with an older fake core nothing is sent and nothing fails; with no core
the app behaves the same but for the notices.
