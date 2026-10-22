# @eleven-labs/nest-profiler-cache

## 1.4.0

### Minor Changes

- 68a0421: Ship an ESM build alongside the CommonJS one. The exports maps serve `import` from `dist/esm` and `require` from `dist`. A CommonJS application, which NestJS 12 keeps supporting, resolves the same CommonJS build as before. An ESM application now imports ESM throughout: on NestJS 12, whose packages are ESM, the profiler no longer makes it go through Node's `require()` of ES modules, which some runtimes turn off (see the [NestJS migration guide](https://docs.nestjs.com/migration-guide#esm-packages)).

  `@eleven-labs/nest-profiler-mikro-orm`, ESM only until now, gets a CommonJS build too, so every package resolves to the same module system as the application that loads it.

- 37746d8: Support NestJS 12 alongside NestJS 11. The peer ranges now accept both majors:

  - `@nestjs/common` and `@nestjs/core`: `^11.0.0 || ^12.0.0` (the core package keeps its `^11.1.4` floor on `@nestjs/core`, required by the `instrument` option).
  - `@nestjs/graphql`: `^13.0.0 || ^14.0.0`.
  - `@nestjs/config`: `^4.0.0 || ^12.0.0`.
  - `@nestjs/cache-manager`: `^3.0.0 || ^12.0.0`.
  - `@nestjs/event-emitter`: `^3.0.0 || ^12.0.0`.
  - `@nestjs/mongoose`: `^11.0.0 || ^12.0.0`.

  No code change is needed on the application side: install the NestJS 12 versions of these packages and the profiler keeps working. On NestJS 12, `@mikro-orm/nestjs` needs 7.1 or later and `@golevelup/nestjs-rabbitmq` 9.1 or later: earlier versions reject NestJS 12 in their own peer ranges.

  NestJS 12 ships its packages as ESM and keeps supporting CommonJS applications, which load them through Node's `require()` of ES modules (Node.js 22.12 or newer). The profiler packages ship CommonJS and load NestJS 12 the same way: a CommonJS application stays CommonJS.

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
