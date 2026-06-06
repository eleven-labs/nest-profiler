# @eleven-labs/nest-profiler-typeorm

## 0.5.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.4.0

### Patch Changes

- 88a9794: Make host-library instrumentation idempotent with a `__profilerPatched` guard, matching the Mongoose collector. Re-initialization (tests, multiple data sources/ORMs) no longer double-wraps queries, HTTP requests or cache operations, which previously caused entries to be recorded twice.

## 0.3.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.2.0

### Patch Changes

- 8980be8: Add `@eleven-labs/nest-profiler-mikro-orm`, a MikroORM query collector that captures SQL queries in the Database panel via the ORM logger. The package ships as ESM-only (`"type": "module"`), matching `@mikro-orm/core` and `@mikro-orm/nestjs` v7 which are ESM-only — it must be consumed from an ESM host.

  Introduce a shared `AbstractSqlQueryCollector` base (plus `QueryEntry`/`QueryType`/`detectQueryType` and the `sql-panel.ejs` template) in `@eleven-labs/nest-profiler` so SQL ORM collectors reuse the rendering contract. The TypeORM collector now extends this base (no public API change).

## 0.1.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.0.1

### Features

- Initial release: TypeORM query collector for `@eleven-labs/nest-profiler`
- Captures all SQL queries executed via TypeORM with operation type, SQL text, and duration
- Slow query highlighting via `slowQueryThreshold` option (default: 100ms)
- Displays query type badges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) in the **Database** panel
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `TypeOrmCollectorModule.forRoot()` configuration
