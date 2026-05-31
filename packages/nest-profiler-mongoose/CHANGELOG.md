# @eleven-labs/nest-profiler-mongoose

## 0.0.1

### Features

- Initial release: Mongoose query collector for `@eleven-labs/nest-profiler`
- Captures all Mongoose queries and aggregations: `find`, `findOne`, `findById`, `updateOne`, `deleteOne`, `deleteMany`, `aggregate`, `countDocuments`, `distinct`
- Records collection name, filter object, duration, and result count per query
- Slow query highlighting via `slowQueryThreshold` option (default: 100ms)
- Anti-double-patch guard — safe to import `MongooseCollectorModule.forRoot()` in multiple modules
- Queries outside a request context (module init, seeding) are silently ignored
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `MongooseCollectorModule.forRoot()` configuration
