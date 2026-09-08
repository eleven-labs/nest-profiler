---
'@eleven-labs/nest-profiler-mikro-orm': patch
---

First public npm (alpha) release. `@eleven-labs/nest-profiler-mikro-orm` is the MikroORM query collector for `@eleven-labs/nest-profiler`:

- Captures SQL queries in the **Database** panel via the MikroORM logger, reusing the core `AbstractSqlQueryCollector` rendering contract (query type, SQL text, duration).
- Idempotent instrumentation (`__profilerPatched`) so queries are never recorded twice.
- Ships as **ESM-only** (`"type": "module"`), matching `@mikro-orm/core` and `@mikro-orm/nestjs` v7 (also ESM-only) — it must be consumed from an ESM host (CJS consumers use a dynamic `import()`).
- `enabled` option (no-op providers when `false`) and `MikroOrmCollectorModule.forRoot()` configuration.
