# Epic 10: The suite

## Status

📋 Planned.

## Overview

What Ledger uses of a Sovereign instance beyond sign-in: the bell, email and the activity log, each degrading when core is absent or older.

## Related

[`DESIGN.md`](../../DESIGN.md) §13.3, §13.4 · `sovereign`'s `docs/using-the-sdk.md` §4

## Tasks

#### ✅ 10.1 — Bell, email and activity

**Goal:** the app's notices where the person already looks. **Design:** §13.4. **Depends on:** 2.3, 1.6.

**Technical:** `src/sovereign/core.ts` wrapping `sv.app.notifications.send`, `sv.app.email.sendToUser` and `sv.app.activity.log` with a `key` per send;
`NotSupportedError` and no core send nothing; the daily bell for upcoming bills (count, once per book and day), a newly firing insight (once per
insight and month), activity lines for export, import and delete everything; the manifest's `core` floor checked against core's changelog for these
calls. Tested against `createFakeCore`.

**Accepts when:** with the scopes granted each notice arrives once per key; with an older fake core nothing is sent and nothing fails; with no core
the app behaves the same but for the notices.

**Done as:** `src/notifications/channels.ts`, where each place a notice goes is one `Channel` with `send(notice)` answering `sent`, `no_channel`, `retry_after`, `not_permitted` or `failed` and
never throwing: **core's bell** (`app.notifications.send`), **core's email** (`app.email.sendToUser`, only for a notice that has an email in it), **the app's own mail** (SMTP, where
there is any) and an **activity logger** (`app.activity.log`). `fanOut` runs every channel with `Promise.allSettled`, so one failing leaves the others. A core that does not serve a call
(`NotSupportedError`), refuses the app (403) or asks to wait puts that channel to **rest for six hours** and says so once; no log line holds a title, a body, an address or a `sub`.
`serverNotifier` (`server.ts`) makes the channels the settings allow, and **with none the jobs claim nothing**, so turning a channel on later sends nothing that was waiting.
`src/notifications/job.ts` is the hourly `notify` job: for each book with an owner it sends **the count of bills waiting to be confirmed, once per book and day by the book's own
calendar**, and **a newly firing insight, once per insight and month**, each claimed first in the new table `book_job_mark` (`(book_id, kind, mark)` unique, written by one conditional
insert that carries the permission, in `BOOK_TABLES`, the export format and `deletePerson`'s seed test; migration 0011) and then sent, so two runs or two processes send once. The
count carries no payee, name or amount. Export and import write a line on the person's activity page (`You exported your book`) through the same notifier, never awaited for and never a
reason for the route to fail. The manifest's `core` floor is **0.80.0**, the release that shipped the last of the three services, checked against `sovereign`'s history. Tests:
`channels.test.ts` (20), `job.test.ts` against `createFakeCore` (claim once, two runs at once, the next day, the book's own zone, nothing for a book that is not the caller's, no channel
no claim) and the portability routes. Mutation checks seen failing: a claim that always succeeds, a claim without the permission, the day taken in UTC, an activity line written before the
import was accepted.

**Left out:** an activity line for "delete everything" (no such action exists; deleting the account removes the person at core as well), and the recap, which is 8.6 and uses these channels. Web
push (`name: 'push'`) is not here: nothing sends one.
