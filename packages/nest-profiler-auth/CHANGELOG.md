# @eleven-labs/nest-profiler-auth

## 1.2.1

### Patch Changes

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-auth` captures the authentication context of the current execution — Passport user, JWT claims, roles — and shows it in a **Security** panel.

  - `AuthCollectorModule` reports the authenticated identity, its roles and the decoded token claims, and works on any transport the profiler knows (HTTP, GraphQL, RabbitMQ, CLI).
  - A `badge` option chooses what the sidebar shows for an authenticated request: `'status'` (default), `'role'` or `'identifier'`; anonymous requests read `anon`.
  - `maskUserFields` masks sensitive identity fields on top of the core redaction.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-auth
