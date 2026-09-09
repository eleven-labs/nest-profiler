# @eleven-labs/nest-profiler-routes

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-routes` adds the **Discover** views to the profiler home — a Symfony-Routing-style view of what the application actually registered.

  - One sidebar view per transport (`Discover / HTTP`, `/ GraphQL`, `/ Commands`, `/ RabbitMQ`), each fed by a `ProfilerDiscoverSource`. A transport that discovered nothing gets no view at all.
  - `RoutesCollectorModule` ships the built-in HTTP source: every route with its method, full path and controller/handler, and a lock on the ones a guard protects.
  - Expanding an entry reveals its description, guards, path and query params, request headers, and the body DTO — class name, decorated properties, TypeScript types, and the validation rules when `class-validator` is installed.
  - Non-HTTP sources describe their inputs in their own vocabulary: commands list Arguments and Options, GraphQL fields list Arguments.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0. `class-validator` is an optional peer, used only to read validation rules.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-routes
