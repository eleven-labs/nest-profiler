# @eleven-labs/nest-profiler-commander

## 1.0.0-alpha.7

### Minor Changes

- 157436f: Push list filtering and pagination down to the storage adapter, add server-side pagination and a SQLite backend, and make list filters/sections declarative.

  `@eleven-labs/nest-profiler`:

  - **Server-side pagination**: each list section paginates independently via a `<sectionKey>_page` query param, with a Prev/Next pager. New `listPageSize` option (default `25`).
  - **Storage-level query pushdown**: new structured `ProfilerQuery` / `FilterCriterion` model and optional `query()` / `distinct()` methods on `IProfilerStorageAdapter`. `ProfilerStorageService` exposes `query()` / `distinct()` and, for adapters that don't implement them, falls back to an in-memory implementation over `findAll()` — so a query-capable store (a database, Redis…) can filter, sort, paginate and count natively instead of loading every profile. Exposes `ProfileSummary` / `summarizeProfile`, `applyQueryInMemory`, `selectPage`, `distinctFromSummaries`, `matchesCriterion` and `sectionTypeConstraint` to help build custom adapters.
  - **File storage**: the file adapter now filters/sorts/paginates over an in-memory `ProfileSummary` index persisted in a `_index.meta` sidecar, reading only the current page's `{token}.json` files; it implements the native `query()` / `distinct()` path.
  - **SQLite storage**: a new adapter under the `@eleven-labs/nest-profiler/sqlite` subpath (`better-sqlite3` as an optional peer dependency) stores each profile as an indexed summary row plus the full document and pushes queries down to SQL (`WHERE … ORDER BY … LIMIT/OFFSET` + `COUNT(*)`).
  - `maxProfiles` and `ttl` can now be **disabled** by passing `0` (or a negative value) — no cap / never expire — on every built-in adapter (the `100` / `3600` defaults are unchanged).
  - **BREAKING** — the list-filter and list-section extension API is now declarative so it can be pushed down:
    - `ProfilerListFilter.matches(profile, value)` is replaced by `toCriterion(value): FilterCriterion`; a dynamic `'select'`'s `optionsFor(profiles)` is replaced by `distinctField` (its options come from `storage.distinct()`).
    - `ProfilerListSection.matches(profile)` is removed; a section owns entrypoint `types` (defaulting to its `key`). `bucketProfilesBySection` and `ProfilerListSectionBucket` are removed in favour of `sectionTypeConstraint`.
    - `ProfilerEntrypointType` gains an optional `indexAttributes(profile)` projection so kind-specific facets are indexable and queryable.

  `@eleven-labs/nest-profiler-graphql`, `@eleven-labs/nest-profiler-rabbitmq`, `@eleven-labs/nest-profiler-commander`:

  - Migrate the contributed list filters to the declarative `toCriterion` API and add each entrypoint type's `indexAttributes` projection (GraphQL `operationType`; RabbitMQ `exchange` / `routingKey` / `handler` / `redelivered`; command `success`), so these scoped filters push down to query-capable storage adapters.

## 1.0.0-alpha.6

### Patch Changes

- d34fefe: Update supported peer dependency ranges and test dependencies for current NestJS 11-compatible releases, including `nestjs-cls` 6, Mongoose 9, and TypeORM 1.

## 1.0.0-alpha.5

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Minor Changes

- 9523bad: Own the command profile shape and its UI instead of relying on core types.

  `CommandProfiler` now builds a `command` entrypoint (`entrypoint.type = 'command'`, the command details on `entrypoint.data`). The package exports its own `CommandInfo` type and `COMMAND_ENTRYPOINT_TYPE`, and `CommanderCollectorModule` registers a `command` entrypoint type with the profiler core — contributing the Commands list table, the **Command** detail tab and a **Status** (success / failed) filter above the Commands list. Import the module in your HTTP app too when you want command profiles produced by the CLI process (shared via file storage) to render in its web profiler.

## 1.0.0-alpha.3

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.2

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.1

### Patch Changes

- Updated dependencies [e4822c6]
  - @eleven-labs/nest-profiler@1.0.0-alpha.1

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-commander` profiles CLI commands built with [nest-commander](https://nest-commander.jaymcdoniel.dev/) — the console equivalent of Symfony's command profiling:
  - Automatically profiles every nest-commander command, with no changes to your command classes.
  - Each run produces a profile (shown alongside HTTP profiles at `/_profiler`) with the command name, positional arguments, parsed options, duration, and exit code.
  - Runs the command body inside the profiler's CLS context, so other collectors (HTTP client, cache, database, …) capture the activity a command triggers.
  - Sets `request.command` so the UI renders commands in a dedicated **Commands** table and **Command** tab.
  - Exceptions thrown by a command are captured and the profile is marked as failed (HTTP-equivalent status `500`).
  - `enabled` option (no providers when `false`) and `CommanderCollectorModule.forRoot()`; optional peer dependency on `nest-commander` (no-op when absent).

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
