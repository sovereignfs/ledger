# Epic 11: Portability

## Status

📋 Planned.

## Overview

One file of everything, and bringing it back.

## Related

[`DESIGN.md`](../../DESIGN.md) §16

## Tasks

#### 📋 11.1 — Export

**Goal:** a person's book in one file. **Design:** §16. **Depends on:** 7.3, 6.5, 8.5.

**Technical:** `src/portability/format.ts` (format `ledger`, version 1) and the export of every book table, read in one short transaction; downloaded
from Settings > Data; an activity line (10.1). A test fails when a book table is not in the format.

**Accepts when:** the file holds every row of a seeded book and nothing of another; a new table fails the test until it is exported.

#### 📋 11.2 — Import

**Goal:** the file, back into an empty book. **Design:** §16. **Depends on:** 11.1.

**Technical:** `validate.ts` reads the whole file first; import only into an empty book; ids re-made and mapped consistently; one transaction; a newer
version refused with a sentence.

**Accepts when:** export → import into a second account → export gives files equal but for ids and times; a malformed file writes nothing.
