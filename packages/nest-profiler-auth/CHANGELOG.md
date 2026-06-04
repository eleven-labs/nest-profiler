# @eleven-labs/nest-profiler-auth

## 0.1.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.0.1

### Features

- Initial release: Auth/Security collector for `@eleven-labs/nest-profiler`
- Captures `request.user` set by Passport or any NestJS guard
- Extracts and displays JWT claims from the `Authorization: Bearer` header
- Sensitive field masking via `maskUserFields` option
- Displays roles, username, and decoded token payload in the **Security** panel
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `AuthCollectorModule.forRoot()` configuration
