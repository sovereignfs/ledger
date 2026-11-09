# Epic 5: The budget

## Status

⏳ In progress: 1 of 4 tasks is done.

## Overview

Categories and subcategories as labels on expenses, income sources, and budgeted amounts that keep their history. Spent comes from the ledger.

## Related

[`DESIGN.md`](../../DESIGN.md) §7

## Tasks

#### ✅ 5.1 — Categories and subcategories

**Goal:** what expenses are labelled with. **Design:** §7.1. **Depends on:** 3.1, 3.2.

**Technical:** `category` (with its currency), `subcategory` (`budget_source` `manual` or `bills`), **both tables made in 4.2**: this task adds their
logic and screens and no migration. Create, rename, reorder, archive; delete only without lines; an expense line's subcategory must be live and the book's.

**Accepts when:** a subcategory with expenses cannot be deleted but can be archived and still shows in past months.

**Done as:** `src/budget/categories.ts`: `createCategory` (the base currency by default, a currency required while the book has none, added to `book_currency`), `createSubcategory` (in a category of the same book, in the statement), renames, `reorderCategories` and `reorderSubcategories` (all-or-nothing: a repeat, an id that is not there or another person's changes nothing), `setCategoryArchived`, and `deleteSubcategory` and `deleteCategory`, whose own statements refuse while any line, or a loan's interest, points at the subcategory (`in_use`; archive instead). Names are unique among their siblings, in any case, with a sentence; `listCategories` returns every category with its subcategories, whether each is used, and whether the category may be deleted. **The one write path now refuses a line on an archived subcategory, or on one whose category is archived**, with a sentence, **except one the entry already has**, so an old entry can still be corrected (`transactions.ts`). Routes `/api/categories` (GET, POST, and PUT to order), `/api/categories/[id]` (PATCH name, archived or the order of its subcategories; DELETE), `/api/categories/[id]/subcategories` (POST) and `/api/subcategories/[id]` (PATCH, DELETE; 409 with a sentence for what has been spent on), in `routes.ts`, called as the second person in `categories-api.test.ts`. The page is **`/budget/categories`**, linked from Budget (5.4 builds the budget itself): make, rename, move up and down, archive and bring back, delete where nothing has been spent, with a note where something has. The tables were made in 4.2. 6 browser tests across Chromium and WebKit; each key test was seen to fail against the code it guards (a delete that ignores lines, an archived subcategory accepted, a rename that allows a taken name). Left out: dragging to reorder (buttons do it, as the API does), a subcategory's `budget_source` of `bills` (6.4), and moving a subcategory to another category.

#### 📋 5.2 — Budget history

**Goal:** a budget for each month, as it was then. **Design:** §7.3. **Depends on:** 5.1.

**Technical:** `budget_amount` for subcategories, income sources and jars; `budgetFor(target, month, rows)`, pure; changing an amount from this month
or next writes a row, never a past one; a budget that ends writes zero.

**Accepts when:** raising Groceries from March leaves February's report at its old amount; two changes in one month keep the later.

#### 📋 5.3 — Income sources and income received

**Goal:** income planned and income that arrived. **Design:** §7.4. **Depends on:** 5.2, 4.3.

**Technical:** `income_source` (one primary, any secondary), each with a budgeted amount through 5.2; income transactions name a source; budgeted vs
received per month; the last primary cannot be deleted.

**Accepts when:** a month shows budgeted and received income separately, converted to the base currency, with a missing rate reported.

#### 📋 5.4 — The budget screen

**Goal:** budgeted vs spent, month by month. **Design:** §7.2, §14.3. **Depends on:** 5.2, 5.3, 4.4.

**Technical:** `/budget?month=`: Bills, Spending and Saving groups (Saving filled by 7.1), a bar per row, totals in the base currency, a month picker;
a selected row (`?row=`) shows its transactions this month and its budget history, and edits its amount (from this month or next). Spent per
subcategory converted to the category's currency at each transaction's date.

**Accepts when:** a split expense counts in both rows; a USD expense in a EUR category is converted at its date; the screen reads the same totals
as the month's report (8.1).
