# @eleven-labs/nest-profiler-validator

## 0.5.0

### Minor Changes

- 64de855: Make the Validator collector agnostic to the validation library.

  `ProfilerValidationPipe` no longer extends NestJS's `ValidationPipe`; it now **wraps** any
  `PipeTransform` and normalizes failures through a chain of pluggable, duck-typed violation
  extractors. Built-in extractors cover `class-validator`, `nestjs-zod`, and a generic
  `HttpException` fallback, so the collector works with whichever validator your app uses.
  - **`class-validator` and `class-transformer` are removed from `peerDependencies`.** They are
    only needed when you use the default class-validator pipe.
  - New `createClassValidatorPipe(options)` helper preserves the rich per-property/constraint panel.
  - New `pipe` / `extractors` options for plugging in any validator (e.g. `pipe: new ZodValidationPipe()`).

  **Breaking — `ValidatorCollectorModule.forRoot` signature changed.** `ValidationPipe` options are
  no longer spread at the top level; pass them under `validationPipeOptions`:

  ```diff
   ValidatorCollectorModule.forRoot({
     enabled,
  -  whitelist: true,
  -  transform: true,
  +  validationPipeOptions: { whitelist: true, transform: true },
   })
  ```

  To use nestjs-zod instead of class-validator:

  ```ts
  import { ZodValidationPipe } from 'nestjs-zod';

  ValidatorCollectorModule.forRoot({ enabled, pipe: new ZodValidationPipe() });
  ```

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
