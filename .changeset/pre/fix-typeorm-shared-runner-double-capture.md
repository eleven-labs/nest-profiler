---
'@eleven-labs/nest-profiler-typeorm': patch
---

Fix duplicate query capture with shared-connection drivers. TypeORM's SQLite drivers memoize a single `QueryRunner`, so `createQueryRunner()` returns the same instance every call and the driver patch re-wrapped its `query`, recording each query N times. The patch now tags the wrapped `query` and skips an already-patched runner.
