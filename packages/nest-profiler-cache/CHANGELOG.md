# @eleven-labs/nest-profiler-cache

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-cache` intercepts `@nestjs/cache-manager` operations during a profiled execution and shows them in a **Cache** panel.

  - `CacheCollectorModule` records every GET HIT, GET MISS, SET and DEL with its key, duration and value, and surfaces the hit/miss ratio as a toolbar badge.
  - Cached values go through the shared redaction and size caps before reaching profile storage.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `@nestjs/cache-manager` ^3 as a peer.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-cache
