# Epic 5: The budget

## Status

📋 Planned.

## Overview

Categories and subcategories as labels on expenses, income sources, and budgeted amounts that keep their history. Spent comes from the ledger.

## Related

[`DESIGN.md`](../../DESIGN.md) §7

## Tasks

#### 📋 5.1 — Categories and subcategories

**Goal:** what expenses are labelled with. **Design:** §7.1. **Depends on:** 3.1, 3.2.

**Technical:** `category` (with its currency), `subcategory` (`budget_source` `manual` or `bills`); create, rename, reorder, archive; delete only
without lines; an expense line's subcategory must be live and the book's.

**Accepts when:** a subcategory with expenses cannot be deleted but can be archived and still shows in past months.

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
