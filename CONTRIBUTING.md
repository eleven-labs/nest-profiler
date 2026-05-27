# Contributing

Thanks for contributing.

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Target a single package:

```bash
pnpm --filter @eleven-labs/nest-profiler test
```

## Pull requests

Every pull request should include:

- A clear description of the change.
- Tests for behavior changes.
- Documentation updates for public API changes.
- A changeset when a published package changes.

## Changesets

Add a changeset for any user-visible package change:

```bash
pnpm changeset
```

Use:

- `patch` for fixes and small improvements.
- `minor` for backward-compatible features.
- `major` for breaking changes.

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
- A migration note.
- Updated examples where relevant.
