---
'@eleven-labs/nest-profiler-typeorm': patch
---

First public npm (alpha) release. `@eleven-labs/nest-profiler-typeorm` is the TypeORM query collector for `@eleven-labs/nest-profiler`:

- Captures SQL queries executed through TypeORM (operation type, SQL text, duration) in the **Database** panel, with query-type badges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), built on the core `AbstractSqlQueryCollector`.
- Slow-query highlighting via `slowQueryThreshold` (default `100`ms).
- Idempotent instrumentation (`__profilerPatched`) so queries are never recorded twice.
- `enabled` option (no-op providers when `false`) and `TypeOrmCollectorModule.forRoot()` configuration.
