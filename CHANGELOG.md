# Changelog

All notable changes to Ledger are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

Each release's section is also its GitHub release notes: the release workflow reads this file when a release is cut. Write the notes under
`## [Unreleased]` as you go; a release turns them into the version's section.

## [Unreleased]

### Added

- The foundation: settings declared once and checked at start-up (a wrong one stops the server, naming it and never its value); the database on three forms (an sqld service, a SQLite file or PostgreSQL) with migrations applied at start-up; background jobs in the web process; a nonce-based Content-Security-Policy and the usual headers; the app shell with its five places (a sidebar on a wide screen, a footer on a phone); browser tests in Chromium and WebKit; the manifest an instance reads, and one image with Compose setups for each database.
- Sign-in with a password, a passkey or an authenticator app, with email verification and reset when there is a mail server; the first account is the only one unless the operator opens sign-up. Settings (the profile, security, the theme, and deleting your account, which says what goes before it asks). A landing page for visitors, and Overview at the same address for someone signed in.
- A book for each person, which is everything of their budget, and the rule that a person reaches only the rows of their own book. Amounts as whole numbers of each currency's smallest unit, with every ISO 4217 currency and its own decimals.
- Exchange rates: a job fetches the day's rates against US dollars from Frankfurter for the currencies a book uses, and keeps one row per currency and day, from which the rate in force on any date is read. It asks for no currency by name, makes no request at all when only dollars are in use, and is turned off with `LEDGER_FX=off`.
- Conversion: an amount is converted at the rate in force on its own date, through US dollars, rounded half to even to the target currency's smallest unit, and a total says which amounts it left out for want of a rate instead of counting them as zero.
- Entries and their lines: one way to write an expense, an income, a transfer (in one currency or two), an opening balance, an adjustment or a new value, which refuses what does not add up in a sentence, and reads anything of another person's book as not there. An account's balance is the sum of its lines, never a stored number.
- Accounts: add a bank account, cash, savings, deposit, investment, property, credit card, loan or a person, each in one currency, with what is in it on a day. The Accounts screen shows your net worth in your base currency and says which amounts it left out for want of a rate; what you owe is said in words ("$420.00 used", "left to pay") and never with a minus. An account can be renamed, archived and brought back, and deleted while it has nothing but its opening balance.
