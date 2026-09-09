# @eleven-labs/nest-profiler-config

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-config` snapshots the application configuration at startup and shows it in a global **Config** panel.

  - `ConfigCollectorModule` flattens the `@nestjs/config` tree into sorted, searchable keys, introspected once at bootstrap.
  - Secret-looking values are masked by default, and `maskKeys` extends the list.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0, with `@nestjs/config` ^4 as a peer.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-config
