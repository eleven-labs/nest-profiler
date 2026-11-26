# Contributing

Thanks for contributing.

## Development

Requirements: Node.js `22+`, pnpm `10+`

```bash
pnpm install
pnpm docker:up      # Postgres + MongoDB + RabbitMQ, only for the example app's infra-backed features
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Target a single package:

```bash
pnpm --filter @eleven-labs/nest-profiler test
```

Run the example API against the profiler UI (it boots with no infrastructure; `pnpm docker:up` is only needed for the SQL / Mongoose / RabbitMQ feature flags):

```bash
pnpm example:dev    # http://localhost:3000/_profiler
```

Serve the documentation site locally:

```bash
pnpm docs:dev       # http://localhost:3002
```

## Repository layout

A pnpm + Turbo monorepo. Publishable packages live under `packages/`; everything else supports them.

```text
packages/
  nest-profiler/            core profiler engine, storage, and UI
  nest-profiler-*/          optional collectors (typeorm, mikro-orm, mongoose, http, cache, auth, config, routes, validator, graphql, commander, rabbitmq, pubsub, event-emitter, ai)
  configs/                  shared @repo/* tooling presets (eslint, jest, prettier, typescript)
examples/
  api/                      NestJS demo app with all collectors enabled
docs/                       Fumadocs documentation site
skills/                     installable agent skills for consumers (npx skills)
scripts/                    repository automation and release helpers
```

## Common commands

Run a task across every package via Turbo:

```bash
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # run unit tests
pnpm test:cov       # run tests with coverage (enforces the 90% threshold)
pnpm build          # build all packages
pnpm docs:dev       # serve the docs site
pnpm docker:up      # start Postgres + MongoDB + RabbitMQ for the example (docker:down to stop)
pnpm attw           # check published type resolution (Are the Types Wrong?)
pnpm changeset      # record a version bump
```

Target a single package with `--filter`:

```bash
pnpm --filter @eleven-labs/nest-profiler test:cov
pnpm --filter @eleven-labs/nest-profiler-typeorm build
```

## Pull requests

Every pull request should include:

- A clear description of the change.
- Tests for behavior changes.
- Documentation updates for public API changes.
- A changeset when a published package changes.

Scope labels (`scope:*` and `package:*`) are applied **automatically** from the changed
files — no need to label PRs by hand. CI runs formatting, lint, typecheck, tests, build,
commit-message and PR-title linting, and the package gates (`publint`, `pack:dry-run`,
`attw`). Keep the **PR title** a valid Conventional Commit: the repo squash-merges, so the
title becomes the commit subject on `main`.

## Changesets

Add a changeset for any user-visible package change:

```bash
pnpm changeset
```

Use:

- `patch` for fixes and small improvements.
- `minor` for backward-compatible features.
- `major` for breaking changes (add a `BREAKING:` note in the changeset body).

## Commit convention

Prefer Conventional Commits:

```text
feat(nest-profiler): add async module config
fix(nest-profiler): preserve profile storage
docs: update publishing guide
```

## Breaking changes

Breaking changes must include:

- A `major` changeset.
- A `BREAKING:` note in the changeset body.
- A migration note and updated examples where relevant.

## Releasing

Packages are versioned with Changesets and released from CI to the public npm registry, from `main`. The versioning policy, the stable release flow, the alpha/beta prerelease runbook, label automation, and the one-time repository setup live in [MAINTAINERS.md](MAINTAINERS.md).
