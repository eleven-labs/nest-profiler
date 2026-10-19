# @eleven-labs/nest-profiler-mikro-orm

## 1.2.1

### Patch Changes

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-mikro-orm` captures every SQL query MikroORM runs during a profiled execution and shows it in a **Database** panel.

  - `MikroOrmCollectorModule` records each query with its SQL, parameters, duration, row count and connection, and feeds the shared performance rules (slow query, N+1, zero-row write).
  - **On-demand `EXPLAIN`** — an Explain button per query runs the plan over the ORM's own connection and renders it inline, flagging full-table scans. PostgreSQL, MySQL/MariaDB and SQLite.
  - `MikroOrmSchemaCollectorModule` adds a global **Schema** panel listing the registered entities with their properties, relations and indexes.
  - Named connections are supported through `connectionName`; the module no-ops instead of crashing when no context is wired.

  Requires Node >= 22.12.0 (stable `require(esm)`), NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `@mikro-orm/core` and `@mikro-orm/nestjs` ^7 as peers.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-mikro-orm
