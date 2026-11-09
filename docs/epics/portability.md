# Epic 11: Portability

## Status

✅ Done: 2 of 2 tasks.

## Overview

One file of everything, and bringing it back.

## Related

[`DESIGN.md`](../../DESIGN.md) §16

## Tasks

#### ✅ 11.1 — Export

**Goal:** a person's book in one file. **Design:** §16. **Depends on:** 7.3, 6.5, 8.5.

**Technical:** `src/portability/format.ts` (format `ledger`, version 1) and the export of every book table, read in one short transaction; downloaded
from Settings > Data; an activity line (10.1). A test fails when a book table is not in the format.

**Accepts when:** the file holds every row of a seeded book and nothing of another; a new table fails the test until it is exported.

**Done as:** `src/portability/format.ts`. **The format is `TABLES`**: for each of the book's tables, which column is its own id, **which columns point at which table**, which column of `budget_amount` points at a
table named by its kind (a subcategory, an income source or a jar), which columns name a **person** (left out of the file and the importer's on import), which column is a recurring entry's template, and what the rows are
ordered by (nothing that is an id, so two exports of one book list the same rows in the same order). Every other column is exported as it is, read from the table's own definition, so **a column added
to a table is in the file without anyone remembering it**; and `format.test.ts` fails when a table in `BOOK_TABLES` is not in the format, when a name in it is not a column of its table, when a table points at one that
comes after it, and when the file leaves out anything but the book's id and the people. `exportBook` reads **the settings and every table in one short transaction**, each statement under the permission, and gives numbers as
numbers (PostgreSQL gives a `bigint` as text) and flags as flags. **Not the rates, and nothing to sign in with**: the test finds neither the person's id, nor the book's, nor the address in the file. `GET /api/export` downloads it
(`ledger-<book>-<day>.json`, `no-store`). **The activity line in core's feed (10.1) waits for 10.1.** Tests: 7 on all three databases (the tables, the columns, the seeded book of 260 entries row for row, nothing of another's, the numbers' kinds, the same file twice) and 1 pure; a browser test.

**Import (11.2), done as:** `validate.ts` reads **the whole file first**, pure: JSON of format `ledger`; a version this one reads (**a newer one is refused with a sentence that names both versions**); the book's settings checked by the same rules as
Settings; every table and no other; every row exactly the columns of its table with values of their kinds (a number is a whole safe number, a flag a flag); every id made once; **every reference to a row that is in the file**, including a
budget's polymorphic target and the accounts, subcategories and income sources inside a recurring entry's template. `import.ts` writes **only into an empty book**, in **one transaction**: it locks the book (its row is written, so two
imports at once cannot both find it empty: the test runs two at once and one wins), refuses a book with anything in it, **makes every id again and maps every reference** (rows and templates) to the new id of what it points at, puts the
importer in for the people, applies the book's settings, and then asks the ledger's own invariants of what it wrote (every entry adds up, every line has one target): a file that fails that, as one whose entries were tampered with does, is
undone whole. **The round trip is a test:** a seeded book is exported, imported into a second account, and exported again, and **the two files are the same book but for ids and times**, compared by giving each row the hash of its own
columns and of the rows it points at (so what is compared is the book and not the ids), with every id shown to be new. `POST /api/import` (a body of up to 64 MB, 413 beyond, 409 with a sentence for a book that has things in it, 400 with
sentences for a file that is not right) and **Settings > Data** with _Export your book_ and a file chooser for _Import_. Tests: 8 on all three databases (nothing written for each kind of bad file, a book with things in it, a book that is not the
caller's, two at once, the round trip, the ids and the importer), 5 on the routes as a second person, and 1 browser test. Each key test was seen to fail against the code it guards (ids kept, references not checked, a table left out, the emptiness
not checked, the templates not remade, a person's column exported).

#### ✅ 11.2 — Import

**Goal:** the file, back into an empty book. **Design:** §16. **Depends on:** 11.1.

**Technical:** `validate.ts` reads the whole file first; import only into an empty book; ids re-made and mapped consistently; one transaction; a newer
version refused with a sentence.

**Accepts when:** export → import into a second account → export gives files equal but for ids and times; a malformed file writes nothing.
