# Epic 12: Release

## Status

📋 Planned.

## Overview

What makes phase 1 releasable and hosted.

## Related

[`DESIGN.md`](../../DESIGN.md) §19 · Tusk's `RELEASING.md`

## Tasks

#### 📋 12.1 — Development seed

**Goal:** a book worth looking at. **Design:** §19 Testing. **Depends on:** 6.5, 7.2.

**Technical:** `pnpm seed [--reset|--remove]`, refusing a non-local database: a year deep, two currencies, every account type, splits, transfers, a
loan, jars, recurring entries of both modes, reviewed and unreviewed months, a missing rate. Grows as later tasks land.

**Accepts when:** a seeded book opens every screen with realistic data on all three databases.

#### 📋 12.2 — Security review

**Goal:** phase 1 reviewed before it is released. **Design:** §19 Security. **Depends on:** 11.2, 8.6.

**Technical:** `docs/security-review-phase-1.md`, as Tusk's: access (§5.2) route by route, deletion (§17), the notices, logs, the CSP, the jobs'
claims; each finding fixed or recorded.

**Accepts when:** the review is written and every finding is fixed or has an owner's decision.

#### 📋 12.3 — Documents

**Goal:** a README a self-hoster can follow. **Depends on:** 1.10.

**Technical:** `README.md` (what it is, running it in each form, every setting, hosting on an instance, the operator's backups), `deploy/README.md`,
`RELEASING.md` and `scripts/release.sh` copied from Tusk.

**Accepts when:** someone following the README alone runs the image on a file database and signs in.

#### 📋 12.4 — Release 0.1.0

**Goal:** the first published image. **Depends on:** 12.2, 12.3.

**Technical:** `scripts/release.sh check | prepare | propose | tag | verify 0.1.0`; the package made public the first time.

**Accepts when:** `ghcr.io/sovereignfs/ledger:0.1.0` exists for amd64 and arm64, with provenance, and boots.

#### 📋 12.5 — Hosting on an instance

**Goal:** Ledger in the live suite. **Depends on:** 12.4.

**Technical:** in `openfs-suite`: `./sv app add ledger --image ghcr.io/sovereignfs/ledger:0.1.0`, the three app scopes granted, `./sv push &&
./sv deploy`; core's table of ports in `sovereign`'s `building-an-app.md` §2 gains 3003.

**Accepts when:** a person opens Ledger from the launcher, signs in through core, completes setup and receives a recap in the bell.
