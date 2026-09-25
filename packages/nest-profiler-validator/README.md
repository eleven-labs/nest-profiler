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
pnpm add -D @eleven-labs/nest-profiler-validator
```

Then install the validator **you** use, as a regular dependency — it is part of your application, not of the profiler:

```bash
# class-validator (default)
pnpm add class-validator class-transformer

# …or nestjs-zod
pnpm add nestjs-zod zod
```

`class-validator`/`class-transformer` are **not** peer dependencies — they are only required when you rely on the default class-validator pipe.

## Setup

Validation stays app-owned: production keeps its own pipe, and the dev entry swaps in the profiler's pipe through the shared `bootstrap()` hook (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency)). The panel is registered with `ValidatorCollectorModule.forRoot()` in the dev-only bundle.

### With class-validator (default)

Production gets the plain `new ValidationPipe(options)` that `bootstrap()` builds by default:

```ts title="main.ts"
import { AppModule } from './app.module';
import { bootstrap } from './bootstrap';

void bootstrap(AppModule);
```

`main-dev.ts` wraps the class-validator pipe with the same options:

```ts title="main-dev.ts"
import { createProfilerLogger } from '@eleven-labs/nest-profiler';
import {
  createClassValidatorPipe,
  createProfilerValidationPipe,
} from '@eleven-labs/nest-profiler-validator';
import { AppDevModule } from './app.dev.module';
import { bootstrap } from './bootstrap';

void bootstrap(AppDevModule, {
  wrapLogger: (logger) => createProfilerLogger(logger),
  validationPipe: (options) => createProfilerValidationPipe(createClassValidatorPipe(options)),
});
```

Wrap `createClassValidatorPipe` (rather than a bare `new ValidationPipe()`) so the raw `ValidationError[]` reaches the panel and violations show per property.

```ts title="profiling/profiling.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

@Module({
  imports: [ProfilerModule.forRoot({ isGlobal: true }), ValidatorCollectorModule.forRoot()],
})
export class ProfilingModule {}
```

> `ProfilingModule` is the dev-only bundle loaded by `main-dev.ts` — see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#recommended-install-it-as-a-dev-dependency). If the profiler is installed as a production dependency behind the [runtime gate](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#when-production-code-calls-the-profiler-conditionalmodule), wrap the same call in `ConditionalModule.registerWhen(..., isProfilerEnabled)`.

### With nestjs-zod

Pass your own pipe; class-validator is never loaded. Production uses `ZodValidationPipe` directly, and `main-dev.ts` wraps it:

```ts title="main.ts"
import { ZodValidationPipe } from 'nestjs-zod';

void bootstrap(AppModule, { validationPipe: () => new ZodValidationPipe() });
```

```ts title="main-dev.ts"
import { ZodValidationPipe } from 'nestjs-zod';

void bootstrap(AppDevModule, {
  wrapLogger: (logger) => createProfilerLogger(logger),
  validationPipe: () => createProfilerValidationPipe(new ZodValidationPipe()),
});
```

> A NestJS app uses a single global validation strategy, so use **one** validator at a time. `createProfilerValidationPipe(inner, extractors?)` also accepts a custom extractor chain as its second argument.

The pipe writes outcomes to CLS and the panel reads them. With the [runtime gate](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#when-production-code-calls-the-profiler-conditionalmodule), where the wrapped pipe also runs in production, it validates and records nothing while the profiler is off (transparent pass-through).

> **e2e / manual bootstrap** — when you boot the app yourself in tests (`Test.createTestingModule(...).createNestApplication()`), mirror the dev entry's `useGlobalPipes(...)` call there too, since the pipe is set in the bootstrap rather than a module.

The extractor chain (`[classValidator, zod, generic]`) rarely needs changing; pass a custom one as the second argument of `createProfilerValidationPipe(inner, extractors)`.

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

app.useGlobalPipes(createProfilerValidationPipe(myPipe, [myExtractor]));
```

## Toolbar badge

- **All valid**: number of validated DTOs (e.g., `1`)
- **With violations**: total violation count (e.g., `3 violations`)

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
