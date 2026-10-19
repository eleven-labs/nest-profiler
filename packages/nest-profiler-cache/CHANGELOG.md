# @eleven-labs/nest-profiler-cache

## 1.2.1

### Patch Changes

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-cache` intercepts `@nestjs/cache-manager` operations during a profiled execution and shows them in a **Cache** panel.

  - `CacheCollectorModule` records every GET HIT, GET MISS, SET and DEL with its key, duration and value, and surfaces the hit/miss ratio as a toolbar badge.
  - Cached values go through the shared redaction and size caps before reaching profile storage.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `@nestjs/cache-manager` ^3 as a peer.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-cache
