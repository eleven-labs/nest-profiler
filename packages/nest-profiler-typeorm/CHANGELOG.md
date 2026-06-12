# @eleven-labs/nest-profiler-typeorm

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

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-typeorm` is the TypeORM query collector for `@eleven-labs/nest-profiler`:
  - Captures SQL queries executed through TypeORM (operation type, SQL text, duration) in the **Database** panel, with query-type badges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), built on the core `AbstractSqlQueryCollector`.
  - Slow-query highlighting via `slowQueryThreshold` (default `100`ms).
  - Idempotent instrumentation (`__profilerPatched`) so queries are never recorded twice.
  - `enabled` option (no-op providers when `false`) and `TypeOrmCollectorModule.forRoot()` configuration.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
