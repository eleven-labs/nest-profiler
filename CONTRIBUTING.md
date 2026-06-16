# Contributing

Thanks for contributing.

## Development

```bash
pnpm install
pnpm docker:up      # Postgres + MongoDB, needed to run the example app
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Target a single package:

```bash
pnpm --filter @eleven-labs/nest-profiler test
```

Run the example API against the profiler UI (needs `pnpm docker:up` first):

```bash
pnpm example:dev    # http://localhost:3000/_profiler
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

Releases and the alpha/beta prerelease flow run in CI from `main`. The full runbook, the
versioning policy, label/milestone automation, and the one-time repository setup
live in [MAINTAINERS.md](MAINTAINERS.md).
