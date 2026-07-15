---
'@eleven-labs/nest-profiler': major
'@eleven-labs/nest-profiler-graphql': major
'@eleven-labs/nest-profiler-http': major
'@eleven-labs/nest-profiler-rabbitmq': minor
'@eleven-labs/nest-profiler-commander': minor
---

Define what counts as an **error**, per package (breaking).

"Error" had one hardcoded meaning: any status ≥ 400, plus any captured exception, always `danger`. But a `404` is a bug for one team and an ordinary answer for another, and a status code means nothing to GraphQL, RabbitMQ or a CLI command. Each entrypoint kind now carries its own definition, and you can redefine it — the `error` tag, its pills and the list's **Errors** checkbox all follow. See [What counts as an error](https://nestjs-profiler-module.vercel.app/en/docs/packages/nest-profiler/error-classification).

**BREAKING — 4xx are no longer errors.** The default is now a status ≥ 500, or a captured exception when no status was recorded. Profiles previously tagged `error` for a `401`/`403`/`404` no longer are, and the **Errors** checkbox no longer keeps them. Restore the old behaviour with `ProfilerModule.forRoot({ error: { httpStatus: 400 } })`. The same shift applies to **outgoing HTTP calls** (`@eleven-labs/nest-profiler-http`): a call is failed when it threw or answered ≥ 500 — restore with `HttpCollectorModule.forRoot({ error: { httpStatus: 400 } })`.

The layers resolve in order, first decisive: `classify` (tri-state — return `undefined` to defer) → `httpStatus`, which when a status is present decides **on its own** → `exceptions`, the fallback for kinds without a status. Layer 2 being decisive is what keeps the defaults coherent: a `NotFoundException` produces both an exception and a `404`, so consulting the exceptions too would contradict the status and re-flag the very 404 you excluded.

- **`@eleven-labs/nest-profiler`** — new `error` option on `ProfilerModule.forRoot()` governing the built-in `http` kind. `ProfilerEntrypointType` gains `isError`/`errorSeverity` (a kind's verdict) and `hiddenFilters` (universal filters it drops from its list). `TagConfig` gains `isErrorEntry`/`errorSeverity`, so `error` is finally severity-configurable like the five other built-in tags. New exports: `resolveProfileErrorClassifier`, `resolveEntryErrorClassifier`, `resolveErrorSeverity`, `buildHttpEntrypointType`, and the `ProfilerErrorOptions`/`EntryErrorOptions`/`ProfileErrorInfo` types. `analyzeProfile()` takes an optional 4th argument carrying the kind's verdict (existing calls keep working; without it, only entries can be errors).
- **New `Exception` list filter** — narrows to one failure type, with options built from the values actually captured (no configuration). It complements the **Errors** checkbox rather than duplicating it: `Errors` asks "what failed, per my definition", `Exception` asks "show me the `NotFoundException`s", whether or not they count as failures. Backed by a new universal `exception` index attribute (the primary exception's code, else its class name).
- **`@eleven-labs/nest-profiler-graphql`** — new `error` option. A GraphQL response is `200` even when the operation failed, so statuses are ignored and `extensions.code` takes their role: only `INTERNAL_SERVER_ERROR` counts by default, plus errors carrying no code. `BAD_USER_INPUT`/`UNAUTHENTICATED`/`NOT_FOUND` are the schema answering correctly. **BREAKING:** `GraphQLCollectorModuleOptions` moved to a dedicated entrypoint (still exported from the package root) and the module now follows the `ConfigurableModuleBuilder` pattern of every other collector, gaining `forRootAsync()`. `ExceptionEntry` gains `code`, populated from `extensions.code` instead of being buried in the `stack` string.
- **`@eleven-labs/nest-profiler-rabbitmq`** — new `error` option. A message has no status, so the default is "the handler threw"; narrow it with `error: { exceptions: ['TimeoutError'] }` when a handler throws as flow control.
- **`@eleven-labs/nest-profiler-commander`** — a non-zero exit is a failure, and that needs no configuration. The Commands list now hides the **Errors** checkbox, its `Status: Success/Failed` filter already asking exactly that.
- The **Errors** checkbox was labelled `With errors`; it is now `Errors`, aligned with the other filter labels (`Status`, `Method`, `Exception`). The query parameter (`<section>_error`) is unchanged.
