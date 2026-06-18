# @eleven-labs/nest-profiler-mongoose

## 1.0.0-alpha.5

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.4

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

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

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-mongoose` is the Mongoose query collector for `@eleven-labs/nest-profiler`:
  - Captures Mongoose queries and aggregations (`find`, `findOne`, `findById`, `updateOne`, `deleteOne`, `deleteMany`, `aggregate`, `countDocuments`, `distinct`) with collection name, filter, duration, and result count, in the **Database** panel.
  - Slow-query highlighting via `slowQueryThreshold` (default `100`ms).
  - Anti-double-patch guard — safe to import `MongooseCollectorModule.forRoot()` in multiple modules; queries outside a request context (module init, seeding) are ignored.
  - `enabled` option (no-op providers when `false`) and `MongooseCollectorModule.forRoot()` configuration.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
