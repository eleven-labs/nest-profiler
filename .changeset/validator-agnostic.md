---
'@eleven-labs/nest-profiler-validator': minor
---

Make the Validator collector agnostic to the validation library.

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
