# @eleven-labs/nest-profiler-typeorm

## 1.2.1

### Patch Changes

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

- 9bacc5c: Support `@nestjs/typeorm` 12. It is ESM-only, so the collector no longer imports it at runtime — it computes the DataSource injection token itself — and the package still loads with `require()` from a CommonJS app. The peer dependency now accepts `^11.0.0 || ^12.0.0`.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-typeorm` captures every SQL query TypeORM runs during a profiled execution and shows it in a **Database** panel.

  - `TypeOrmCollectorModule` records each query with its SQL, parameters, duration, row count and connection, and feeds the shared performance rules (slow query, N+1, zero-row write).
  - **On-demand `EXPLAIN`** — an Explain button per query runs the plan over the ORM's own connection and renders it inline, flagging full-table scans. PostgreSQL, MySQL/MariaDB and SQLite.
  - `TypeOrmSchemaCollectorModule` adds a global **Schema** panel listing the registered entities with their columns, relations and indexes.
  - Named connections are supported through `connectionName`; the module no-ops instead of crashing when no `DataSource` is wired or initialized.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `typeorm` >=0.3.20 <2.0.0 and `@nestjs/typeorm` ^11 as peers.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-typeorm
