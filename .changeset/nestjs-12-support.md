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

Support NestJS 12 alongside NestJS 11. The peer ranges now accept both majors:

- `@nestjs/common` and `@nestjs/core`: `^11.0.0 || ^12.0.0` (the core package keeps its `^11.1.4` floor on `@nestjs/core`, required by the `instrument` option).
- `@nestjs/graphql`: `^13.0.0 || ^14.0.0`.
- `@nestjs/config`: `^4.0.0 || ^12.0.0`.
- `@nestjs/cache-manager`: `^3.0.0 || ^12.0.0`.
- `@nestjs/event-emitter`: `^3.0.0 || ^12.0.0`.
- `@nestjs/mongoose`: `^11.0.0 || ^12.0.0`.

No code change is needed on the application side: install the NestJS 12 versions of these packages and the profiler keeps working. On NestJS 12, `@mikro-orm/nestjs` needs 7.1 or later and `@golevelup/nestjs-rabbitmq` 9.1 or later: earlier versions reject NestJS 12 in their own peer ranges.

NestJS 12 ships ESM only and the profiler packages still ship CommonJS, so on NestJS 12 they rely on Node's `require()` of ES modules, enabled by default from Node.js 22.12.
