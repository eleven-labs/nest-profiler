# @eleven-labs/nest-profiler-config

## 0.4.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.3.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.2.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.1.0

### Minor Changes

- Version bump only — released in lockstep with `@eleven-labs/nest-profiler` to keep the suite on a single version (Changesets `fixed` group). No functional changes to this package.

## 0.0.1

### Features

- Initial release: `@nestjs/config` collector for `@eleven-labs/nest-profiler`
- Captures a flattened snapshot of `ConfigService` configuration at application bootstrap
- Secret/sensitive key masking via `maskKeys` option (supports dot-notation, e.g. `database.password`)
- Global collector — appears on the profiles list and every profile detail view
- Displays configuration in the **Config** panel with masked values shown as `***`
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `ConfigCollectorModule.forRoot()` configuration
