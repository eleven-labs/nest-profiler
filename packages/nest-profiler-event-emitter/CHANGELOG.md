# @eleven-labs/nest-profiler-event-emitter

## 1.3.0

### Patch Changes

- 1d604a6: Show the event icon next to the Events entry of the profiler sidebar.

## 1.2.1

### Patch Changes

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-event-emitter` captures the domain events an application dispatches through `@nestjs/event-emitter`.

  - Every emission shows up in an **Events** panel on the profile that published it, with its name and payload.
  - Each `@OnEvent` handler execution becomes a profile of its own by default, so the work an event triggers stops being invisible — with whatever queries, cache reads and outgoing calls it made.
  - `EventDiscoverSource` contributes the **Discover / Events** view, listing every subscription.
  - Request-scoped subscribers are listed but not profiled: `@nestjs/event-emitter` resolves a fresh instance per event, so there is no stable handler to wrap.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `@nestjs/event-emitter` ^3 as a peer.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-event-emitter
