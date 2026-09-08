---
'@eleven-labs/nest-profiler-validator': minor
---

Make validation app-owned so the Validator panel is fully decoupled from the profiler.

- `createProfilerValidationPipe(inner, extractors?)` builds the wrapping pipe for `app.useGlobalPipes(...)`, keeping global validation in your own bootstrap. It resolves CLS through `nestjs-cls`'s static `ClsServiceManager`, so it needs no DI container and is a transparent pass-through when the profiler is off.
- `ValidatorCollectorModule` now registers **only** the Validator panel (`forRoot()` / `forRootAsync()`, `enabled` as the sole option) — like every other collector — so it gates cleanly with `ConditionalModule.registerWhen(...)` while validation always runs.

The module no longer owns an `APP_PIPE`: the `pipe`, `validationPipeOptions` and `extractors` module options are gone (choose the validator and extractors when building the pipe in `main.ts`), and `ProfilerValidationPipe` is constructed via `createProfilerValidationPipe(...)` rather than DI.
