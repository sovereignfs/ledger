# Epic 4: The ledger

## Status

⏳ In progress: 2 of 9 tasks are done.

## Overview

Money accounts whose balances are derived, transactions made of lines that add up, and everything a person does with them day to day. This is what
the plugin did not have: 4.2 is the centre, and its invariants are held by every later write.

## Related

[`DESIGN.md`](../../DESIGN.md) §6, §14.4, §18.3

## Tasks

#### ✅ 4.1 — Money accounts

**Goal:** every kind of account, with its opening balance. **Design:** §6.1, §6.4. **Depends on:** 3.1, 3.2, 4.2.

**Technical:** `money_account` (**the table was made in 4.2**) and `loan`; the nine types and their sides; making one writes an `opening` transaction; edit name and institution,
archive, delete only with nothing but its opening; `/accounts` grouped by side with net worth (in the base currency through 3.4); `/accounts/<id>`
with its entries, credit used and available, a loan's left and paid, a person's owes-you or you-owe.

**Accepts when:** a new account shows its opening balance; an account with entries cannot be deleted but can be archived and stays in past totals;
the person's words never show a minus for money owed.

**Done as:** `src/ledger/`: `account-types.ts` (the nine types with their sides, and pure checks that refuse in sentences: a name, a currency, a limit only on a card, loan terms only on a loan, an end that is not before the start, a rate as decimal text), `accounts.ts` (`createAccount` writes the account, adds its currency to `book_currency`, writes a loan's terms and the opening balance **as an `opening` entry through 4.2's one path, in the same database transaction** (`runWrite` and `insertTransaction` are exported for this), so an account never exists without the balance it was given; `updateAccount` changes the name, institution, a card's limit and a loan's lender, end, instalment and rate, never the currency or kind; `setArchived`; `deleteAccount`, whose own statement refuses while any entry but an opening has a line on the account, deleting the opening and the loan with it; `listAccounts`, `getAccount` with balance, loan terms and `deletable`; `entriesOf`). **`loan`** is a new table (migration `0005_loan`, in `BOOK_TABLES`, seeded by the deletion test). `present.ts`: **a balance is said in words, never with a minus for money owed** ("$420.00 used", "left to pay", "You owe $5.00", "overdrawn"), a card's used and available, a loan's left and paid. **Routes** `/api/accounts` (GET, POST) and `/api/accounts/[id]` (GET, PATCH with `archived`, DELETE, 409 with a sentence for an account that has been used), in `routes.ts`; what they do is in `src/access/accounts-api.ts`, with the body read by `account-input.ts` (types checked, unknown fields ignored, capped at 16 KiB) so that `accounts-api.test.ts` calls every one **as the second person**: a 404 with nothing in it, nothing changed, the same answer as for an account that never was. **Screens:** `/accounts` (net worth in the base currency at today's rates through 3.4, with "N amounts in XXX not included" and, with no base currency yet, one total for each currency; the accounts in what you have, what you owe and people; `?archived=1`), the Add account dialog (what is owed is typed as an amount, and the sign is made once, in the dialog), and `/accounts/[id]` (the summary, a card's limit, used and available, a loan's terms, the entries newest first, rename, archive or bring back, delete only while it is allowed). `todayIn(timeZone)` in `src/dates.ts` gives the book's own today. 8 browser tests across Chromium and WebKit: an account with its opening balance, a card read as "$420.00 used" with no minus, archive and bring back and delete, and a refusal shown in the dialog. Left out: a loan's interest subcategory is accepted by the API and checked to be the book's but the dialog does not offer it (5.1 gives it something to choose); an account's page is not paged beyond its latest 100 entries (the transactions list, 4.7); a person's opening direction is chosen in the dialog and is not changeable after, as an entry (4.3 edits it).

#### ✅ 4.2 — Transactions and lines

**Goal:** the one write path, and its invariants. **Design:** §6.2, §6.3, §6.8. **Depends on:** 3.1, 3.2.

**Technical:** `txn`, `txn_line`; `src/ledger/` validators for each type (which targets, signs, exactly one target per line, lines add up to zero in
the currency, the transfer exception records two amounts), every target the same book's in the statement; create, edit (lines replaced in one
transaction) and delete; balances as sums, by date; the property test of random sequences of writes.

**Accepts when:** a transaction whose lines do not add up is refused with a sentence; a line pointing at another book's subcategory reads as not
found; after a thousand random writes every balance equals its lines.

**Done as:** `src/ledger/`. **Tables** (migration `0004_transactions`, both dialects): `txn`, `txn_line`, and, because every line points at one and "the same book's, in the statement" cannot be held against a table that is not there, **`money_account`, `category`, `subcategory` and `income_source`** with the columns `DESIGN.md` §18.3 gives them; what a person can do with them (make, edit, archive, the screens) stays with 4.1, 5.1 and 5.3, which now add logic and no migration for these. All six are in `BOOK_TABLES` (in the order of deletion) and `people.test.ts` now seeds a row of each for two people and fails for a table of a book that it did not seed. `payee_id` and `recurring_id` with `occurrence_date` (unique together) are columns for 4.5 and 6.2; nothing writes them yet. **`validate.ts`**, pure: a line names exactly one of an account, a subcategory, an income source or equity; an amount is a non-zero whole number in a currency that is one; each type has the targets it may (an expense an account that paid and subcategories, and a second account only on a loan or a credit card, so a loan instalment is one entry; an income one account and income sources; a transfer two different accounts; an opening, an adjustment and a new value one account and its own equity, and a new value only on an investment or a property); **the lines add up to zero in the entry's currency**, the transfer of two currencies being the one exception, whose two lines are one down and one up. Each refusal is a sentence ("The lines add up to -1.00 USD, and they must add up to nothing: …") that names no one's thing. **`transactions.ts`** is the one path: `createTransaction`, `updateTransaction` (the lines replaced in one transaction with the entry's own row; a status not given is kept) and `deleteTransaction` (entry and lines together; safe to repeat). The shape is checked first; then the entry's row is written under the permission (`inBook`), then every account, subcategory and income source the lines name is found in the book (anything not found, or another person's, is `not_found`), then the accounts' types and currencies are checked, then each line is written by a statement that again requires the entry to be the account's and its target the same book's; a refusal anywhere rolls the whole write back. **`balances.ts`:** a balance is the sum of an account's lines on or before a date, never written, and another person's account has none. **`invariants.ts`:** `findViolations` asks the rows themselves (one target a line, every entry adds up, two currencies only in a transfer of two lines, no entry without lines or line without entry). **The property test:** a thousand seeded random writes (every type, edits, deletions, and writes that must be refused), a model kept in the test, balances equal to the model's at every hundredth write and on four dates at the end, no violation, and the other person's book untouched. Each key test was seen to fail against the code it guards (the same-book check dropped, the sum check dropped, an edit that keeps the old lines, a delete that keeps them, balances that ignore the date, no permission on a delete); the permission on the entry's own `INSERT` and `UPDATE` is **a second line of defence that no outside call can observe**, since the read of the targets that follows is under it too, so dropping either alone changes no answer. `isCalendarDay` moved to `src/dates.ts`. Left out: no route or server action yet (the add dialog, 4.3, adds them with their `routes.ts` entries and second-person tests); a write to an **archived** account is not refused here (the pickers hide them, 4.3); a loan's line must be in the paying account's currency (one currency to an entry).

#### 📋 4.3 — The add dialog

**Goal:** logging in seconds, from anywhere. **Design:** §14.4. **Depends on:** 4.1, 5.1.

**Technical:** `Dialog` wide and `Drawer` narrow, one form: type, amount (`MoneyInput` in the account's currency), account, subcategory or income
source, date (today), note; Enter saves; "Save and add another"; applied at once and undone on a refusal; a note when the date counts towards another
month; edit and delete from the same dialog. Remembers the last account.

**Accepts when:** an expense is logged with the keyboard alone; a refused save restores the list and says why; reopening shows a blank form.

#### 📋 4.4 — Splits

**Goal:** one payment across several subcategories or income sources. **Design:** §6.2, §14.4. **Depends on:** 4.3.

**Technical:** "Split" in the dialog adds lines; the remainder is shown until they add up; the list shows "Split" and the parts on hover and in detail;
each part counts towards its own subcategory's spent.

**Accepts when:** 84.20 split 61.00 and 23.20 lands in both subcategories; saving with a remainder is refused before submitting.

#### 📋 4.5 — Payees

**Goal:** who was paid, remembered. **Design:** §6.5. **Depends on:** 4.3.

**Technical:** `payee`; made on first use, autocomplete (`SuggestionInput`), the last subcategory and account proposed; rename, merge (lines move in
one transaction), archive; `/payees/<id>` with totals by month.

**Accepts when:** typing a known payee proposes its last subcategory; merging two payees leaves every transaction on the survivor.

#### 📋 4.6 — Transfers

**Goal:** money between accounts, in one or two currencies. **Design:** §6.2, §6.8. **Depends on:** 4.3.

**Technical:** the transfer form: from, to, amount, and a second amount when the currencies differ, showing the implied rate; card payments, lending
to and receiving from a person; a refund as a negative expense.

**Accepts when:** paying a card from checking changes both balances and no spending figure; a EUR→USD transfer keeps both amounts and shows their
rate.

#### 📋 4.7 — The transactions list

**Goal:** every entry, findable. **Design:** §6.9. **Depends on:** 4.4, 4.5, 4.6.

**Technical:** `/transactions`, newest first, paged by date; filters in the address (account, category or subcategory, payee, type, status, date
range, text in payee and note, matched as text, never a pattern); a running balance with one account filtered; bulk clear, recategorise, delete.

**Accepts when:** each filter and their combinations return the right rows on all three databases; an address with filters reopens the same view.

#### 📋 4.8 — Status and reconciling

**Goal:** a balance that matches the bank's. **Design:** §6.4, §6.7. **Depends on:** 4.7.

**Technical:** `status` pending or cleared, toggled by hand; Reconcile on an account: statement balance and date, the difference from cleared entries
to that date, confirm writes an `adjustment` (if not zero) and clears the pending entries to the date, in one transaction.

**Accepts when:** reconciling to a statement 1.20 above records an adjustment of 1.20 and clears every entry to the date; reconciling again to the
same figure records nothing.

#### 📋 4.9 — Revaluation

**Goal:** what an investment or a property is worth. **Design:** §6.6. **Depends on:** 4.1.

**Technical:** "Value on date" on investment and property accounts writes a `revaluation` of the difference; their page shows the value history; not
income, not spending.

**Accepts when:** valuing a fund at 10,500 from 10,000 raises net worth by 500 and changes no report's income or spent.
