# Changelog

All notable changes to Ledger are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

Each release's section is also its GitHub release notes: the release workflow reads this file when a release is cut. Write the notes under
`## [Unreleased]` as you go; a release turns them into the version's section.

## [Unreleased]

### Added

- The foundation: settings declared once and checked at start-up (a wrong one stops the server, naming it and never its value); the database on three forms (an sqld service, a SQLite file or PostgreSQL) with migrations applied at start-up; background jobs in the web process; a nonce-based Content-Security-Policy and the usual headers; the app shell with its five places (a sidebar on a wide screen, a footer on a phone); browser tests in Chromium and WebKit; the manifest an instance reads, and one image with Compose setups for each database.
