# @eleven-labs/nest-profiler-mikro-orm

## 0.4.0

### Patch Changes

- 88a9794: Make host-library instrumentation idempotent with a `__profilerPatched` guard, matching the Mongoose collector. Re-initialization (tests, multiple data sources/ORMs) no longer double-wraps queries, HTTP requests or cache operations, which previously caused entries to be recorded twice.

## 0.3.0

### Minor Changes

- Updated dependencies [09586a0]
  - @eleven-labs/nest-profiler@0.3.0

## 0.2.0

### Minor Changes

- 8980be8: Add `@eleven-labs/nest-profiler-mikro-orm`, a MikroORM query collector that captures SQL queries in the Database panel via the ORM logger. The package ships as ESM-only (`"type": "module"`), matching `@mikro-orm/core` and `@mikro-orm/nestjs` v7 which are ESM-only — it must be consumed from an ESM host.

  Introduce a shared `AbstractSqlQueryCollector` base (plus `QueryEntry`/`QueryType`/`detectQueryType` and the `sql-panel.ejs` template) in `@eleven-labs/nest-profiler` so SQL ORM collectors reuse the rendering contract. The TypeORM collector now extends this base (no public API change).

### Minor Changes

- Updated dependencies [8980be8]
  - @eleven-labs/nest-profiler@0.2.0
