# @eleven-labs/nest-profiler-mikro-orm

## 1.0.0-alpha.6

### Patch Changes

- d34fefe: Update supported peer dependency ranges and test dependencies for current NestJS 11-compatible releases, including `nestjs-cls` 6, Mongoose 9, and TypeORM 1.

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

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-mikro-orm` is the MikroORM query collector for `@eleven-labs/nest-profiler`:
  - Captures SQL queries in the **Database** panel via the MikroORM logger, reusing the core `AbstractSqlQueryCollector` rendering contract (query type, SQL text, duration).
  - Idempotent instrumentation (`__profilerPatched`) so queries are never recorded twice.
  - Ships as **ESM-only** (`"type": "module"`), matching `@mikro-orm/core` and `@mikro-orm/nestjs` v7 (also ESM-only) — it must be consumed from an ESM host (CJS consumers use a dynamic `import()`).
  - `enabled` option (no-op providers when `false`) and `MikroOrmCollectorModule.forRoot()` configuration.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
