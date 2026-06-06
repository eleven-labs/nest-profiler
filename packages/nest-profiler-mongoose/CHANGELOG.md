# @eleven-labs/nest-profiler-mongoose

## 0.4.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.3.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.2.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.1.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

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
