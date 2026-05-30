# @eleven-labs/nest-profiler-auth

## 0.0.1

### Features

- Initial release: Auth/Security collector for `@eleven-labs/nest-profiler`
- Captures `request.user` set by Passport or any NestJS guard
- Extracts and displays JWT claims from the `Authorization: Bearer` header
- Sensitive field masking via `maskUserFields` option
- Displays roles, username, and decoded token payload in the **Security** panel
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `AuthCollectorModule.forRoot()` configuration
