---
'@eleven-labs/nest-profiler-event-emitter': major
---

First stable release. `@eleven-labs/nest-profiler-event-emitter` captures the domain events an application dispatches through `@nestjs/event-emitter`.

- Every emission shows up in an **Events** panel on the profile that published it, with its name and payload.
- Each `@OnEvent` handler execution becomes a profile of its own by default, so the work an event triggers stops being invisible — with whatever queries, cache reads and outgoing calls it made.
- `EventDiscoverSource` contributes the **Discover / Events** view, listing every subscription.
- Request-scoped subscribers are listed but not profiled: `@nestjs/event-emitter` resolves a fresh instance per event, so there is no stable handler to wrap.

Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `@nestjs/event-emitter` ^3 as a peer.

Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-event-emitter
