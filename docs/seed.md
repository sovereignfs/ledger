# The development seed

`pnpm seed` fills the book of an account that has signed in with **a year of realistic data and a state for every feature built so far**, so that any screen can be
looked at, and any change tried, without making data by hand. It is `DESIGN.md` §19's seed (task 12.1), and it grows with the app: **a task that adds a screen adds its
state to it** (`src/seed/states.ts`) and a row to the table below, and `src/seed/seed.test.ts` fails if the state is not there.

```bash
pnpm dev            # once, and sign up at http://localhost:3003/sign-up
pnpm seed           # fills the book of the first account; refuses a book that already has accounts
pnpm seed --reset   # empties the book first, then fills it
pnpm seed --remove  # only empties it
pnpm seed --email you@example.com   # another account than the oldest
```

It writes only to a database on this machine (a file, or `localhost`) and says so if it is asked to do otherwise. Everything is made through the code the screens use, so
the book obeys what a real one does (the invariant checks pass over all of it), and **two seeds on the same day make the same book**: the dates are relative to today and the
amounts come from a generator seeded by the day.

## What is in it

The year (`src/seed/seed.ts`): 13 months, 17 accounts in USD, EUR, CHF, JPY and BHD, about 300 entries, 11 bills, 5 jars.

| To look at                      | Where                        | What the seed has                                                                                                                                                          |
| ------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every kind of account           | Accounts                     | Checking, wallet, savings, deposit, brokerage, a flat, a Visa, a car loan, two people, euros, francs, yen, dinars; net worth by month end                                  |
| Money you owe, and are owed     | Accounts                     | Alex owes you (`Owes you $60.00`); you owe Sam (`You owe $80.00`); the card and the loan are said in words, never with a minus                                             |
| A missing rate                  | Accounts, Overview           | No rate for the Swiss franc: "1 amount in CHF not included", never counted as nothing                                                                                      |
| Currencies of other shapes      | Accounts, an entry           | Yen with no decimals (`¥295,200`) and dinars with three (`BHD 150.000`), each with a rate                                                                                  |
| Values of things                | An investment, the flat      | The brokerage valued each quarter, the flat twice                                                                                                                          |
| Reconciling                     | An account's page            | Checking and savings reconciled to last month's end; the wallet was short, so it is overdrawn and has an adjustment                                                        |
| Transfers, refunds, two amounts | Transactions                 | Savings each month, the card paid off, a refund, euros bought with dollars, money lent and part paid back                                                                  |
| Splits                          | Transactions, Budget         | A shop receipt split between groceries and the pharmacy, in both rows                                                                                                      |
| Pending and cleared             | Transactions                 | Everything up to last month's end is cleared; this month's is pending                                                                                                      |
| Budget and its history          | Budget                       | A budget for every subcategory; Groceries raised four months ago, Eating out raised from next month; income budgeted, with a second source                                 |
| Bills that post themselves      | Bills, Transactions          | Salary, rent, internet, a subscription, a yearly insurance that **budgets its subcategory**, a loan's instalments split into interest and principal; a fortnightly cleaner |
| Bills that ask first            | Overview, Transactions       | City Power due today, with a year of confirmed ones; **Climbing Gym** overdue; **Daily Paper**, whose first occurrence was skipped, overdue                                |
| A bill that has ended           | Bills                        | Old Gym                                                                                                                                                                    |
| Jars                            | Accounts, Overview           | Travel (with a flight paid from it), Emergency fund, **Laptop** (target reached), **Holiday** (never fits: Overview says so), **Old plan** (archived)                      |
| Insights                        | Overview, a month's report   | Eating out and Utilities over budget two months running; a garage bill of 450.00 against a usual 56                                                                        |
| The month-end review            | Reports, Overview            | The nine oldest completed months reviewed, the last three not: Overview's banner names the latest                                                                          |
| Archived things                 | Categories, Accounts, Payees | A category with history ("Old hobbies"), a closed account, an archived payee (Chemist), an archived jar                                                                    |
| A payee merged                  | Payees                       | "Corner Mart", typed twice, merged into "Corner Market" with its entries                                                                                                   |
| Other scripts and long names    | Everywhere a name is shown   | An Arabic payee with a note in four scripts and emoji; an account named in Cyrillic, with emoji, long enough to wrap                                                       |
| Text is text                    | Transactions                 | A payee of `<b>Bold</b> & <script>alert(1)</script>` and a note of `"><img src=x onerror=alert(1)>`, which must be shown as literal text and run nothing                   |
| Year and month reports          | Reports                      | A year by month, category and subcategory; net worth over time; each month's figures                                                                                       |

**Not in it, because they are not the book's:** the notices' claims (`book_job_mark`: a seeded one would stop a notice being sent), sign-in through a core, and the exchange-rate
fetch. The recap and the daily bell are tried against the SDK's fake core, in `src/notifications/`.

## Adding to it

A new state goes in `src/seed/states.ts` (or the year in `seed.ts` if it is part of ordinary life), **through the same functions the screens use and never by writing rows**, and with
a test in `src/seed/seed.test.ts` that finds it. Keep it deterministic: dates from `today`, amounts from the day's generator or fixed. The round-trip test of export and import
(`src/portability/import.test.ts`) runs over this book, so a table a state fills is checked there as well.
