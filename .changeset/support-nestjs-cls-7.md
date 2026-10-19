---
'@eleven-labs/nest-profiler': patch
'@eleven-labs/nest-profiler-ai': patch
'@eleven-labs/nest-profiler-auth': patch
'@eleven-labs/nest-profiler-cache': patch
'@eleven-labs/nest-profiler-commander': patch
'@eleven-labs/nest-profiler-event-emitter': patch
'@eleven-labs/nest-profiler-graphql': patch
'@eleven-labs/nest-profiler-http': patch
'@eleven-labs/nest-profiler-mikro-orm': patch
'@eleven-labs/nest-profiler-mongoose': patch
'@eleven-labs/nest-profiler-rabbitmq': patch
'@eleven-labs/nest-profiler-typeorm': patch
'@eleven-labs/nest-profiler-validator': patch
---

Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.
