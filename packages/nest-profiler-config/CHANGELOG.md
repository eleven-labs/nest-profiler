# @eleven-labs/nest-profiler-config

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

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-config` is the `@nestjs/config` collector for `@eleven-labs/nest-profiler`:
  - Captures a flattened snapshot of the `ConfigService` configuration at application bootstrap.
  - Global collector — appears on the profiles list and on every profile detail view, in the **Config** panel.
  - Secret/sensitive-key masking via `maskKeys` (dot-notation supported, e.g. `database.password`); masked values shown as `***`.
  - `enabled` option — when `false`, registers no-op providers only (the host app owns the dev/prod decision).
  - `ConfigCollectorModule.forRoot()` configuration.

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
