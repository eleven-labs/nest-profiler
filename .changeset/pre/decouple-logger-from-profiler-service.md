---
'@eleven-labs/nest-profiler': minor
---

Decouple log capture from `ProfilerService`: `createProfilerLogger` is now the single, DI-free way to capture logs.

`createProfilerLogger(delegate, options?)` no longer takes a `ProfilerService` argument — it resolves the active profile statically from the process-wide CLS store, exactly like `createProfilerValidationPipe`. Build it anywhere (typically in `main.ts`) and pass it to `app.useLogger(...)` with no `app.get(ProfilerService)`:

```ts
import { createProfilerLogger } from '@eleven-labs/nest-profiler';

app.useLogger(createProfilerLogger(new ConsoleLogger('App')));
```

With no active profile (profiler disabled, bootstrap, or a background job) it is a transparent pass-through, so no log line is ever lost.

**Breaking changes:**

- `ProfilerService.createLogger(...)` is removed — use the standalone `createProfilerLogger(delegate, options?)`.
- `ProfilerService.addLog(...)` is removed — capture logs by wrapping your logger with `createProfilerLogger` instead.
- `createProfilerLogger`'s second parameter is now the options object directly (`createProfilerLogger(delegate, options)`), not a `ProfilerService`.

Because the logger no longer resolves `ProfilerService`, `ProfilerNoopModule` is only needed when your app injects `ProfilerService` directly (`startSpan`, `addEvent`, `addException`, `setSecurityContext`, `getCurrentToken`). Apps that only capture logs and rely on collectors can drop the no-op fallback entirely.
