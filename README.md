# Ledger

Your budget, your accounts and your net worth, in every currency you use. Ledger runs on its own or on a
[Sovereign](https://github.com/sovereignfs/sovereign) instance.

It is a two-sided ledger: an account's balance is the sum of what was entered against it, every expense says which account paid it, and a budget
keeps its history so that a past month shows what was planned then. It replaces the Sovereign ledger plugin; none of its code is carried over.

**Status: being built.** Nothing runs yet. [`DESIGN.md`](DESIGN.md) says what Ledger is and how it is built, [`ROADMAP.md`](ROADMAP.md) puts the work
in order, and [`docs/epics/`](docs/epics/) holds each task. How to work on it is in [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

## Develop

You need Node 24.15 or newer and [pnpm](https://pnpm.io) (the version is `packageManager` in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm dev   # http://localhost:3003
```

## Licence

AGPL-3.0-or-later. Bundling `@sovereignfs/ui` makes it so, and every dependency's licence must be compatible.
