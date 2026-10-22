---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-ai': minor
'@eleven-labs/nest-profiler-auth': minor
'@eleven-labs/nest-profiler-cache': minor
'@eleven-labs/nest-profiler-commander': minor
'@eleven-labs/nest-profiler-config': minor
'@eleven-labs/nest-profiler-event-emitter': minor
'@eleven-labs/nest-profiler-graphql': minor
'@eleven-labs/nest-profiler-http': minor
'@eleven-labs/nest-profiler-mikro-orm': minor
'@eleven-labs/nest-profiler-mongoose': minor
'@eleven-labs/nest-profiler-rabbitmq': minor
'@eleven-labs/nest-profiler-routes': minor
'@eleven-labs/nest-profiler-typeorm': minor
'@eleven-labs/nest-profiler-validator': minor
---

Ship an ESM build alongside the CommonJS one. The exports maps serve `import` from `dist/esm` and `require` from `dist`. A CommonJS application, which NestJS 12 keeps supporting, resolves the same CommonJS build as before. An ESM application now imports ESM throughout: on NestJS 12, whose packages are ESM, the profiler no longer makes it go through Node's `require()` of ES modules, which some runtimes turn off (see the [NestJS migration guide](https://docs.nestjs.com/migration-guide#esm-packages)).

`@eleven-labs/nest-profiler-mikro-orm`, ESM only until now, gets a CommonJS build too, so every package resolves to the same module system as the application that loads it.
