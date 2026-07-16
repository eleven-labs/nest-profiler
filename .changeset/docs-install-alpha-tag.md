---
'@eleven-labs/nest-profiler': patch
'@eleven-labs/nest-profiler-auth': patch
'@eleven-labs/nest-profiler-cache': patch
'@eleven-labs/nest-profiler-commander': patch
'@eleven-labs/nest-profiler-config': patch
'@eleven-labs/nest-profiler-graphql': patch
'@eleven-labs/nest-profiler-http': patch
'@eleven-labs/nest-profiler-mikro-orm': patch
'@eleven-labs/nest-profiler-mongoose': patch
'@eleven-labs/nest-profiler-rabbitmq': patch
'@eleven-labs/nest-profiler-routes': patch
'@eleven-labs/nest-profiler-typeorm': patch
'@eleven-labs/nest-profiler-validator': patch
---

Document the `@alpha` install tag in every package README.

- Install commands now pin `@eleven-labs/nest-profiler*` packages to the `@alpha` dist-tag, since there is no stable release yet (`@latest` resolves to nothing).
- Added a short note next to each install snippet explaining the requirement.
