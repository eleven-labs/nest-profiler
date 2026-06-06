# @eleven-labs/nest-profiler-validator

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

- Initial release: Validation pipe collector for `@eleven-labs/nest-profiler`
- Captures DTO validation results from `class-validator` via `ProfilerValidationPipe`
- Records validated DTO class name, validation status (valid / invalid), and all property violations with constraint names
- Badge shows total DTO count validated during the request (details in the panel)
- Badge reads from final collected storage (always visible even after `collect()` clears the private key)
- `enabled` option — when `false`, registers no-op providers only (the host application owns the dev/prod decision)
- `ValidatorCollectorModule.forRoot()` configuration with `whitelist`, `transform`, and other standard `ValidationPipeOptions`
