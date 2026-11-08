# Epic 4: The ledger

## Status

📋 Planned.

## Overview

Money accounts whose balances are derived, transactions made of lines that add up, and everything a person does with them day to day. This is what
the plugin did not have: 4.2 is the centre, and its invariants are held by every later write.

## Related

[`DESIGN.md`](../../DESIGN.md) §6, §14.4, §18.3

## Tasks

#### 📋 4.1 — Money accounts

**Goal:** every kind of account, with its opening balance. **Design:** §6.1, §6.4. **Depends on:** 3.1, 3.2, 4.2.

**Technical:** `money_account` and `loan`; the nine types and their sides; making one writes an `opening` transaction; edit name and institution,
archive, delete only with nothing but its opening; `/accounts` grouped by side with net worth (in the base currency through 3.4); `/accounts/<id>`
with its entries, credit used and available, a loan's left and paid, a person's owes-you or you-owe.

**Accepts when:** a new account shows its opening balance; an account with entries cannot be deleted but can be archived and stays in past totals;
the person's words never show a minus for money owed.

#### 📋 4.2 — Transactions and lines

**Goal:** the one write path, and its invariants. **Design:** §6.2, §6.3, §6.8. **Depends on:** 3.1, 3.2.

**Technical:** `txn`, `txn_line`; `src/ledger/` validators for each type (which targets, signs, exactly one target per line, lines add up to zero in
the currency, the transfer exception records two amounts), every target the same book's in the statement; create, edit (lines replaced in one
transaction) and delete; balances as sums, by date; the property test of random sequences of writes.

**Accepts when:** a transaction whose lines do not add up is refused with a sentence; a line pointing at another book's subcategory reads as not
found; after a thousand random writes every balance equals its lines.

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
