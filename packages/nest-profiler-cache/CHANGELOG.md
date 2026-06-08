# @eleven-labs/nest-profiler-cache

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-cache` is the cache collector for `@eleven-labs/nest-profiler`:
  - Captures `GET_HIT`, `GET_MISS`, `SET`, and `DEL` operations from `@nestjs/cache-manager`.
  - Shows the cache key, operation type, and TTL per entry in the **Cache** panel, with a hit/miss ratio badge in the toolbar.
  - Idempotent instrumentation (`__profilerPatched`) so operations are never recorded twice.
  - `enabled` option — when `false`, registers no-op providers only (the host app owns the dev/prod decision).
  - `CacheCollectorModule.forRoot()` configuration.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
