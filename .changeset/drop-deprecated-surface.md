---
'@eleven-labs/nest-profiler': major
---

BREAKING: remove the deprecated surface so the first stable release ships one way to do each thing.

`ProfilerModuleOptions` no longer carries the flat masking options `maskCookies`, `maskHeaders`, `useDefaultMaskHeaders`, `maskQueryParams` and `useDefaultMaskQueryParams`. The unified `redaction` block replaces all five: `redaction.cookies`, `redaction.headers`, `redaction.queryParams`, and `redaction.useDefaults: false` for the total opt-out that the two `useDefaultMask*` flags used to express per list. `resolveRedactionConfig()` now resolves that block alone, so there is a single merge to reason about instead of two surfaces that had to agree.

`StorageFindOptions` is removed and `IProfilerStorageAdapter.findAll()` takes no argument. The dashboard has driven its lists through `ProfilerQuery` / `query()` for a while and nothing passed those HTTP-centric filters any more; the in-memory filter helper behind them goes with the type. A custom adapter that declared `findAll(options?)` keeps compiling — the parameter is simply never supplied — and one that filtered on it should implement `query()` instead.

These options are per-collector, not core, and are untouched: `maskHeaders` on `nest-profiler-http` and `nest-profiler-rabbitmq`, `maskKeys` on `nest-profiler-config`, `maskUserFields` on `nest-profiler-auth`.
