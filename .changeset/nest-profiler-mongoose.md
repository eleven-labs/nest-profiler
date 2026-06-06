---
'@eleven-labs/nest-profiler-mongoose': patch
---

First public npm (alpha) release. `@eleven-labs/nest-profiler-mongoose` is the Mongoose query collector for `@eleven-labs/nest-profiler`:

- Captures Mongoose queries and aggregations (`find`, `findOne`, `findById`, `updateOne`, `deleteOne`, `deleteMany`, `aggregate`, `countDocuments`, `distinct`) with collection name, filter, duration, and result count, in the **Database** panel.
- Slow-query highlighting via `slowQueryThreshold` (default `100`ms).
- Anti-double-patch guard — safe to import `MongooseCollectorModule.forRoot()` in multiple modules; queries outside a request context (module init, seeding) are ignored.
- `enabled` option (no-op providers when `false`) and `MongooseCollectorModule.forRoot()` configuration.
