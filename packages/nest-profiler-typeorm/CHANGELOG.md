# @eleven-labs/nest-profiler-typeorm

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
