# @eleven-labs/nest-profiler-cache

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

- Initial release: Cache collector for `@eleven-labs/nest-profiler`
- Captures `GET_HIT`, `GET_MISS`, `SET`, and `DEL` operations from `@nestjs/cache-manager`
- Displays hit/miss ratio badge in the toolbar
- Shows cache key, operation type, and TTL for each entry in the **Cache** panel
- Badge reads from final collected storage (always visible even after `collect()` clears the private key)
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `CacheCollectorModule.forRoot()` configuration
