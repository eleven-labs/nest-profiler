# @eleven-labs/nest-profiler-auth

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-auth` captures the authentication context of the current execution — Passport user, JWT claims, roles — and shows it in a **Security** panel.

  - `AuthCollectorModule` reports the authenticated identity, its roles and the decoded token claims, and works on any transport the profiler knows (HTTP, GraphQL, RabbitMQ, CLI).
  - A `badge` option chooses what the sidebar shows for an authenticated request: `'status'` (default), `'role'` or `'identifier'`; anonymous requests read `anon`.
  - `maskUserFields` masks sensitive identity fields on top of the core redaction.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-auth
