# Validation collector — `@eleven-labs/nest-profiler-validator`

Captures every validation outcome (payload, violations) into a profiler panel by wrapping your validation pipe.

- **Peers:** `nestjs-cls@^6` (required); `class-validator@>=0.14 <1` + `class-transformer@^0.5` **optional** (only for the default class-validator pipe).
- **Module:** `ValidatorCollectorModule` (`forRoot` + `forRootAsync`), option `enabled` only — it registers just the **panel**. The validation pipe is app-owned.
- **Placement:** the panel goes in the `ProfilingModule` bundle; the pipe is installed by the bootstrap.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-validator> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/validator-collector>

## How it works

Validation is **app-owned**: the bootstrap installs the pipe, and the module contributes only the `ValidatorCollector` panel. With the dev-dependency install, the shared `bootstrap()` takes a `validationPipe` hook: production `main.ts` gets a plain pipe, `main-dev.ts` passes `createProfilerValidationPipe(...)` with the same options. With the `ConditionalModule` install, `main.ts` installs `createProfilerValidationPipe(...)` unconditionally. Either way validation always runs, while the panel lives with the other collectors. The pipe writes outcomes to CLS (resolved via `nestjs-cls`'s static `ClsServiceManager`, no DI); the panel reads them only when the profiler is loaded.

**Key question to ask:** which engine — **class-validator** (default) or **zod** (`nestjs-zod`)?

## ⚠️ Gotchas

- **One global validation pipe only.** Wrap the app's existing pipe with `createProfilerValidationPipe(...)` — don't add a second `useGlobalPipes`/`APP_PIPE`. An `APP_PIPE` provider in a production module has to move to the bootstrap (or become a hook) so the dev entry can swap it.
- **Wrap `createClassValidatorPipe`, not a bare `ValidationPipe`**, for class-validator — it attaches the raw `ValidationError[]` the extractor reads, so per-property violations reach the panel.
- **Mirror the bootstrap in e2e tests.** The pipe lives in the bootstrap, so reuse it (or replicate the `useGlobalPipes(...)` call) when you boot the app manually in tests.
- **Use value imports for DTOs** (`import { CreateUserDto }`, not `import type`) so `reflect-metadata` emits the metatype the pipe needs.

## Snippets

```ts title="main-dev.ts — class-validator (default); main.ts keeps the bootstrap's plain ValidationPipe"
import {
  createProfilerValidationPipe,
  createClassValidatorPipe,
} from '@eleven-labs/nest-profiler-validator';

void bootstrap(AppDevModule, {
  wrapLogger: (logger) => createProfilerLogger(logger),
  validationPipe: (options) => createProfilerValidationPipe(createClassValidatorPipe(options)),
});
```

```ts title="main-dev.ts — zod (nestjs-zod); the bootstrap's default is `new ZodValidationPipe()`"
import { ZodValidationPipe } from 'nestjs-zod';
import { createProfilerValidationPipe } from '@eleven-labs/nest-profiler-validator';

void bootstrap(AppDevModule, {
validationPipe: () => createProfilerValidationPipe(new ZodValidationPipe()),
});

````

```ts title="main.ts — ConditionalModule install"
app.useGlobalPipes(
  createProfilerValidationPipe(createClassValidatorPipe({ whitelist: true, transform: true })),
);
````

```ts title="profiling/profiling.module.ts — panel only"
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

// in ProfilingModule's imports:
ValidatorCollectorModule.forRoot(),
```

A custom extractor chain (default `[classValidator, zod, generic]`) goes as the second argument of `createProfilerValidationPipe(inner, extractors)`.
