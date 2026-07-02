---
'@eleven-labs/nest-profiler': minor
---

Add `ProfilerNoopModule` and `NoopProfilerService` — a zero-dependency no-op path for when the profiler is disabled. Pair `ProfilerNoopModule` with `ConditionalModule.registerWhen` as the fallback so `ProfilerService` stays injectable everywhere and consumers never fail with "cannot resolve dependency ProfilerService":

```ts
ConditionalModule.registerWhen(ProfilerModule.forRootAsync({ isGlobal: true, ... }), isProfilerEnabled),
ConditionalModule.registerWhen(ProfilerNoopModule.forRoot({ isGlobal: true }), (env) => !isProfilerEnabled(env)),
```

`NoopProfilerService` implements the full `ProfilerService` public API but injects nothing (no `ClsService`, no core), so the disabled path has no runtime cost. The core module's inert (`enabled: false`) layer now binds `ProfilerService` to it too — the disabled path no longer imports `ClsModule` nor runs the async options factory.

`ConditionalModule` is now the recommended way to enable/disable profiling; the top-level `enabled` option remains fully supported as the alternative.

Remove the non-functional `path` option from `ProfilerModuleOptions`: the profiler UI is always mounted at `/_profiler` (the controller routes and middleware are fixed), so a custom `path` produced a broken UI. The base path is now the internal `PROFILER_BASE_PATH` constant.
