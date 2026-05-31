# @eleven-labs/nest-profiler-validator

`@eleven-labs/nest-profiler-validator` extends NestJS's `ValidationPipe` to capture every DTO validation result (valid or invalid) and display it in a dedicated **Validator** panel, inspired by Symfony's Web Profiler validator tab.

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-validator class-validator class-transformer
```

**Peer dependencies:** `class-validator ^0.14.0`, `class-transformer ^0.5.0`

## Setup

`ValidatorCollectorModule.forRoot()` registers `ProfilerValidationPipe` as the global `APP_PIPE`. It replaces the standard `ValidationPipe` — **do not register both**.

```ts title="app.module.ts"
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

@Module({
  imports: [
    ProfilerModule.forRoot({ isGlobal: true }),
    ValidatorCollectorModule.forRoot({
      whitelist: true, // remove extra properties
      transform: true, // transform payload to DTO class
      // any other ValidationPipe options
    }),
  ],
})
export class AppModule {}
```

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
- `value` — the rejected value
- `constraints` — map of constraint name → message (e.g., `{ isNotEmpty: "name should not be empty" }`)

## Example: DTO with constraints

```ts title="create-product.dto.ts"
import { IsNotEmpty, IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsNumber()
  @Min(0)
  price: number;
}
```

A request with `POST /products { "name": "", "price": -5 }` produces a profile showing:

**Validator panel:**

```
[BODY] CreateProductDto — INVALID (2 violations)
  name  ""   isNotEmpty  → name should not be empty
  price  -5  min         → price must not be less than 0
```

## Toolbar badge

- **All valid**: number of validated DTOs (e.g., `1`)
- **With violations**: total violation count (e.g., `3 violations`)

## How it works

`ProfilerValidationPipe` extends `ValidationPipe` and overrides two methods:

1. **`validate()`** — called by the parent pipe with the transformed entity before checking for errors. Stores the raw `ValidationError[]` in CLS under a per-request key.

2. **`transform()`** — wraps the parent's `transform()`. On success, records a valid entry. On failure (pipe exception), reads the raw errors from CLS, maps them to `ViolationEntry[]`, and records an invalid entry. The original exception is always re-thrown.

This design is concurrent-safe: CLS provides per-request isolated storage, and the raw `ValidationError[]` from class-validator are captured before they're converted to strings by the exception factory.

> **Note:** The profiler interceptor captures collector data on both success and error paths, so validation failures are always recorded even when the request returns a 400.
