# @eleven-labs/nest-profiler-validator

## 1.2.1

### Patch Changes

- 18c1e52: Support `nestjs-cls` 7: the peer dependency now accepts `^6.0.0 || ^7.0.0`.

  With `nestjs-cls` 7, the MikroORM collector captured no queries. `nestjs-cls` now ships an ESM build next to its CommonJS one, so the `ClsService` this ESM package imported was not the class the core registered, and resolving it found nothing. The collector now reads the request context through `ClsServiceManager`, which `nestjs-cls` shares between its two builds.

## 1.0.0

### Major Changes

- 3a507ec: First stable release. `@eleven-labs/nest-profiler-validator` captures every DTO validation result — valid or invalid — and shows it in a **Validator** panel, after Symfony's validator tab.

  - **Validator-agnostic.** Rather than binding to `class-validator`, `createProfilerValidationPipe(inner, extractors?)` wraps _any_ validation `PipeTransform` and normalizes its failures through pluggable, duck-typed extractors. Built-in extractors cover **class-validator**, **nestjs-zod** and a generic `HttpException` fallback.
  - **Validation stays app-owned.** The pipe lives in your own `app.useGlobalPipes(...)` and resolves CLS statically, so it needs no DI container and is a transparent pass-through when the profiler is off. `ValidatorCollectorModule` registers only the panel, so it gates cleanly with `ConditionalModule.registerWhen(...)` while validation always runs.
  - A throwing custom extractor can never turn a 400 into a 500.

  Requires Node >= 22, NestJS 11 and `@eleven-labs/nest-profiler` ^1.0.0. `class-validator` and `class-transformer` are optional peers.

  Documentation: https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-validator
