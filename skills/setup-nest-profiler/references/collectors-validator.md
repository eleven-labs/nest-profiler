# Validation collector — `@eleven-labs/nest-profiler-validator`

Captures every validation outcome (payload, violations) into a profiler panel by installing a global validation pipe that wraps yours.

- **Peers:** `nestjs-cls@^6` (required); `class-validator@>=0.14 <1` + `class-transformer@^0.5` **optional** (only for the default class-validator pipe).
- **Module:** `ValidatorCollectorModule` (`forRoot` + `forRootAsync`).
- **Placement:** the composition root — it registers a global `APP_PIPE`. Bundle it into `ProfilingModule` with the other root-level collectors.
- Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-validator> · tutorial: <https://nest-profiler.eleven-labs.com/docs/tutorials/validator-collector>

## Options

| Option                  | Type                    | Default                          | Notes                                                                                                           |
| ----------------------- | ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean`               | `true`                           | `false` = profiling off, but the validation pipe is **still installed** (validation never silently disappears). |
| `pipe`                  | `PipeTransform`         | class-validator `ValidationPipe` | Provide your own pipe, e.g. `nestjs-zod`'s `ZodValidationPipe`.                                                 |
| `validationPipeOptions` | `ValidationPipeOptions` | —                                | Forwarded to the default class-validator pipe when `pipe` is omitted.                                           |

`extractors` (default `[classValidator, zod, generic]`, covering both engines) rarely needs changing — see the [package docs](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-validator).

## ⚠️ Gotchas

- **Do not register a second global `ValidationPipe`.** This collector already installs one via `APP_PIPE`. If the app had `app.useGlobalPipes(new ValidationPipe(...))` or an `APP_PIPE` provider, remove it and move its options into `validationPipeOptions` (or into your own `pipe`).
- **Use value imports for DTOs** (`import { CreateUserDto }`, not `import type`) so `reflect-metadata` emits the metatype the pipe needs.

**Key question to ask:** which validation engine — **class-validator** (default) or **zod** (`nestjs-zod`)?

## Snippets

```ts title="class-validator (default)"
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

ConditionalModule.registerWhen(
  ValidatorCollectorModule.forRoot({ validationPipeOptions: { whitelist: true, transform: true } }),
  isProfilerEnabled,
),
```

```ts title="zod (nestjs-zod)"
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';
import { ZodValidationPipe } from 'nestjs-zod';

ConditionalModule.registerWhen(
  ValidatorCollectorModule.forRoot({ pipe: new ZodValidationPipe() }),
  isProfilerEnabled,
),
```
