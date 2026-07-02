# @eleven-labs/nest-profiler-validator

<p align="center">
  <a href="https://eleven-labs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-white.svg">
      <img alt="Powered &amp; maintained by Eleven Labs" src="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-dark.svg" width="180">
    </picture>
  </a>
</p>

<p align="center"><em>Powered &amp; maintained by <a href="https://eleven-labs.com">Eleven Labs</a></em></p>

<p align="center">
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml/badge.svg" /></a>
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-validator" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-validator"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-validator` captures every DTO validation result (valid or invalid) and displays it in a dedicated **Validator** panel, inspired by Symfony's Web Profiler validator tab.

It is **validator-agnostic**: instead of being tied to `class-validator`, it wraps _any_ validation `PipeTransform` and normalizes failures through pluggable, duck-typed extractors. Built-in extractors cover **class-validator**, **nestjs-zod**, and a generic `HttpException` fallback.

![Validator panel — DTO validation results with per-property constraint violations](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/validator.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-validator
```

Then install the validator **you** use:

```bash
# class-validator (default)
pnpm add class-validator class-transformer

# …or nestjs-zod
pnpm add nestjs-zod zod
```

`class-validator`/`class-transformer` are **not** peer dependencies — they are only required when you rely on the default class-validator pipe.

## Setup

`ValidatorCollectorModule.forRoot()` registers `ProfilerValidationPipe` as the global `APP_PIPE`. It wraps your validation pipe — **do not also register a separate global `ValidationPipe`**.

### With class-validator (default)

When `pipe` is omitted, a class-validator `ValidationPipe` is built from `validationPipeOptions`:

```ts title="app.module.ts"
import { ConditionalModule } from '@nestjs/config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] !== 'false';

@Module({
  imports: [
    ConditionalModule.registerWhen(
      ValidatorCollectorModule.forRoot({
        validationPipeOptions: {
          whitelist: true, // remove extra properties
          transform: true, // transform payload to DTO class
          // any other ValidationPipe options
        },
      }),
      isProfilerEnabled,
    ),
  ],
})
export class AppModule {}
```

### With nestjs-zod

Pass your own pipe via `pipe`; class-validator is never loaded:

```ts title="app.module.ts"
import { ZodValidationPipe } from 'nestjs-zod';

ConditionalModule.registerWhen(
  ValidatorCollectorModule.forRoot({ pipe: new ZodValidationPipe() }),
  isProfilerEnabled,
),
```

> A NestJS app uses a single global validation strategy, so use **one** validator at a time.

## Options

| Option                  | Type                             | Description                                                                                  |
| ----------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `pipe`                  | `PipeTransform`                  | The validation pipe to wrap. Defaults to a class-validator pipe built from the option below. |
| `validationPipeOptions` | `ValidationPipeOptions`          | Forwarded to the default class-validator pipe when `pipe` is omitted.                        |
| `extractors`            | `ValidationViolationExtractor[]` | Override the extractor chain. Defaults to `[classValidator, zod, generic]`.                  |

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` and its `ProfilerNoopModule` fallback **once at the root** — the recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

## Prerequisite: value import for DTO types

For `reflect-metadata` to emit the DTO class constructor as parameter metadata, use a **value import** (not `import type`) on the DTO in your controllers:

```ts title="products.controller.ts"
// ✓ value import — emits reflect-metadata
import { CreateProductDto } from './dto/create-product.dto';

// ✗ type-only import — metadata is erased, metatype shows as 'Function'
import type { CreateProductDto } from './dto/create-product.dto';
```

## What it captures

For each `@Body()`, `@Query()`, or `@Param()` parameter using a DTO class:

| Field            | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `source`         | `body`, `query`, `param`, or `custom`                     |
| `dtoClass`       | DTO class name (e.g., `CreateProductDto`)                 |
| `status`         | `valid` or `invalid`                                      |
| `violationCount` | Total number of constraint violations                     |
| `violations`     | Per-property breakdown with constraint names and messages |

Each violation entry includes:

- `property` — the property path that failed (nested properties use dot notation)
- `value` — the rejected value (when available)
- `constraints` — map of constraint name → message (e.g., `{ isNotEmpty: "name should not be empty" }`)

## How it works

`ProfilerValidationPipe` implements `PipeTransform` and wraps an **inner** pipe:

1. On `transform()`, it delegates to the inner pipe. On success it records a `valid` entry.
2. On failure it runs the configured **extractors** over the thrown error, records an `invalid` entry with the normalized violations, then re-throws the original exception.

Extractors are tried in order; the first to recognize the error wins:

- **class-validator** — `createClassValidatorPipe()` attaches the raw `ValidationError[]` to the thrown exception (under a private symbol) so the full property/constraint tree is recovered.
- **nestjs-zod / zod** — reads `ZodError.issues` (via `getZodError()` or a bare `ZodError`).
- **generic** — any `HttpException` exposing a `message` string/array (the universal fallback).

Reading the active profile uses CLS, so capture is concurrent-safe across requests.

## Custom extractors

To support another validator, implement `ValidationViolationExtractor` and pass it via `extractors`:

```ts
import type { ValidationViolationExtractor } from '@eleven-labs/nest-profiler-validator';

const myExtractor: ValidationViolationExtractor = {
  extract({ error }) {
    // return ViolationEntry[] if recognized, otherwise null to defer to the next extractor
    return null;
  },
};

ValidatorCollectorModule.forRoot({ pipe: myPipe, extractors: [myExtractor] });
```

## Toolbar badge

- **All valid**: number of validated DTOs (e.g., `1`)
- **With violations**: total violation count (e.g., `3 violations`)

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
