# @eleven-labs/nest-profiler-auth

## 1.0.0-alpha.4

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.3

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.2

### Patch Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 1.0.0-alpha.1

### Patch Changes

- Updated dependencies [e4822c6]
  - @eleven-labs/nest-profiler@1.0.0-alpha.1

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-auth` is the Auth/Security collector for `@eleven-labs/nest-profiler`:
  - Captures `request.user` set by Passport or any NestJS guard.
  - Extracts and displays JWT claims from the `Authorization: Bearer` header.
  - Renders roles, username, and the decoded token payload in the **Security** panel.
  - Sensitive-field masking via the `maskUserFields` option.
  - `enabled` option — when `false`, registers no-op providers only (the host app owns the dev/prod decision).
  - `AuthCollectorModule.forRoot()` configuration.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
