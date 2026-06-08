# @eleven-labs/nest-profiler-validator

## 0.5.1-alpha.0

### Patch Changes

- ff89de2: First public npm (alpha) release. `@eleven-labs/nest-profiler-validator` is the validation collector for `@eleven-labs/nest-profiler`, agnostic to the validation library:
  - `ProfilerValidationPipe` wraps any `PipeTransform` and normalizes failures through a chain of pluggable, duck-typed violation extractors. Built-in extractors cover `class-validator`, `nestjs-zod`, and a generic `HttpException` fallback.
  - Records the validated DTO class name, validation status (valid/invalid), and every property violation with its constraint names, in the **Validator** panel; a badge shows the DTO count validated per request.
  - `createClassValidatorPipe(options)` helper preserves the rich per-property/constraint panel for class-validator users; `pipe` / `extractors` options plug in any validator (e.g. `pipe: new ZodValidationPipe()`).
  - `class-validator` / `class-transformer` are optional (not peer dependencies) — needed only for the default class-validator pipe.
  - `enabled` option (no-op providers when `false`) and `ValidatorCollectorModule.forRoot()` (validation-pipe options under `validationPipeOptions`).

- Updated dependencies [ff89de2]
  - @eleven-labs/nest-profiler@0.5.1-alpha.0
