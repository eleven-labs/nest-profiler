---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-auth': patch
'@eleven-labs/nest-profiler-cache': patch
'@eleven-labs/nest-profiler-commander': patch
'@eleven-labs/nest-profiler-config': patch
'@eleven-labs/nest-profiler-graphql': patch
'@eleven-labs/nest-profiler-http': patch
'@eleven-labs/nest-profiler-mikro-orm': patch
'@eleven-labs/nest-profiler-mongoose': patch
'@eleven-labs/nest-profiler-rabbitmq': patch
'@eleven-labs/nest-profiler-typeorm': patch
'@eleven-labs/nest-profiler-validator': patch
---

Consolidate three sets of internals that had been copied across the workspace, and record exception causes.

**Reading the active profile.** `readProfile`, `readToken`, `readRequest` and `setProfileContext` are the way to reach the profiling context. The CLS store was previously addressed by string literal in 24 places across ten packages, each with its own `try`/`catch` — and `PROFILER_CLS_KEYS`, which existed precisely to prevent that, was used almost nowhere. A mistyped key reads as `undefined` rather than failing, silently turning a collector into a no-op; the accessors remove the opportunity. `PROFILER_CLS_KEYS` also gains the `token` key it was missing while three packages wrote the literal.

**Exception causes and codes.** `toExceptionEntry` replaces the four hand-rolled constructions of an `ExceptionEntry` (the interceptor's HTTP and non-HTTP paths, the catch-all exception filter, the command profiler), which had all drifted into recording only `name`, `message` and `stack`. Two things are now captured:

- **`ExceptionEntry.cause`** — the `cause` chain of a wrapped error, recorded recursively to a bounded depth and cycle-safe. An `InternalServerErrorException` says nothing; the `QueryFailedError` underneath says everything. The Exceptions tab renders the chain as one `Caused by` block per level.
- **`ExceptionEntry.code`** — a machine-readable code carried by the error (`ENOENT`, `ECONNREFUSED`, a driver's own), which the `exception` list filter groups by in preference to the class name.

Coercion of a non-`Error` throw is deliberately unchanged, so existing profiles keep grouping under `Error`.

**Shared collector options.** `CollectorModuleOptions` (the `enabled` flag, previously redeclared in twelve interfaces) and `TagSeverityOptions` (the tag severities, redeclared in five) are declared once in the core and extended by each collector's options interface. Only options whose meaning _and_ default are identical everywhere moved: the numeric thresholds stay per package, because a slow SQL query is 100 ms, a slow outgoing HTTP call 300 ms and a slow publish 50 ms — that default is the useful half of the documentation.

No behaviour change and no configuration change: every option keeps its name, type and default, and the accessors return exactly what the code they replace returned.
