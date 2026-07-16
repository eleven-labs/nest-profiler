# Validation collector — `@eleven-labs/nest-profiler-validator`

Captures every validation outcome (payload, violations) into a profiler panel by wrapping your validation pipe.

- **Peers:** `nestjs-cls@^6` (required); `class-validator@>=0.14 <1` + `class-transformer@^0.5` **optional** (only for the default class-validator pipe).
- **Module:** `ValidatorCollectorModule` (`forRoot` + `forRootAsync`), option `enabled` only — it registers just the **panel**. The validation pipe is app-owned.
- **Placement:** the composition root. Bundle it into `ProfilingModule` with the other root-level collectors.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-validator> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/validator-collector>

## How it works

Validation is **app-owned**: you install the pipe in `main.ts` with `createProfilerValidationPipe(...)`, and the module contributes only the `ValidatorCollector` panel. That decouples validation from the profiler — validation always runs, while the panel is gated like every other collector. The pipe writes outcomes to CLS (resolved via `nestjs-cls`'s static `ClsServiceManager`, no DI); the gated panel reads them only when the profiler is on.

**Key question to ask:** which engine — **class-validator** (default) or **zod** (`nestjs-zod`)?

## ⚠️ Gotchas

- **One global validation pipe only.** Wrap the app's existing pipe with `createProfilerValidationPipe(...)` — don't add a second `useGlobalPipes`/`APP_PIPE`.
- **Wrap `createClassValidatorPipe`, not a bare `ValidationPipe`**, for class-validator — it attaches the raw `ValidationError[]` the extractor reads, so per-property violations reach the panel.
- **Mirror the bootstrap in e2e tests.** The pipe lives in `main.ts`, so replicate the `useGlobalPipes(...)` call when you boot the app manually in tests.
- **Use value imports for DTOs** (`import { CreateUserDto }`, not `import type`) so `reflect-metadata` emits the metatype the pipe needs.

## Snippets

```ts title="main.ts — class-validator (default)"
import {
  createProfilerValidationPipe,
  createClassValidatorPipe,
} from '@eleven-labs/nest-profiler-validator';

app.useGlobalPipes(
  createProfilerValidationPipe(createClassValidatorPipe({ whitelist: true, transform: true })),
);
```

```ts title="main.ts — zod (nestjs-zod)"
import { ZodValidationPipe } from 'nestjs-zod';
import { createProfilerValidationPipe } from '@eleven-labs/nest-profiler-validator';

app.useGlobalPipes(createProfilerValidationPipe(new ZodValidationPipe()));
```

```ts title="app.module.ts — panel only, gated like every other collector"
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

ConditionalModule.registerWhen(ValidatorCollectorModule.forRoot(), isProfilerEnabled),
```

A custom extractor chain (default `[classValidator, zod, generic]`) goes as the second argument of `createProfilerValidationPipe(inner, extractors)`.
