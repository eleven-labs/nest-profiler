---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-graphql': minor
'@eleven-labs/nest-profiler-http': patch
'@eleven-labs/nest-profiler-mongoose': patch
'@eleven-labs/nest-profiler-typeorm': patch
'@eleven-labs/nest-profiler-mikro-orm': patch
'@eleven-labs/nest-profiler-commander': patch
'@eleven-labs/nest-profiler-cache': patch
'@eleven-labs/nest-profiler-rabbitmq': patch
'@eleven-labs/nest-profiler-validator': patch
---

Turn the Timeline into a unified, causally-nested trace waterfall. `buildTrace` assembles a `TraceSpan` tree (on `Profile.trace`) that merges the lifecycle phases, outgoing HTTP calls, database queries and — with `nest-profiler-graphql` — each GraphQL `resolveField` into one nested view on a single time axis. Spans nest by causality, carry their performance tags (slow, N+1) and self-time, and deep-link to their source panel row.

`createProfilerFieldMiddleware` (nest-profiler-graphql) times each `resolveField` and stamps its span onto the DB/HTTP calls it issues, so an N+1 reads as one field with its repeated child queries. A flat Request Lifecycle band (`guards`, `controller`, `validation`) sits above the waterfall for HTTP requests, controlled by the new `lifecycleSpans` option. Every profile — including bare requests, CLI commands and consumed messages — now gets a Timeline.

Every timed surface now reads a sub-millisecond clock (`performance.timeOrigin + performance.now()`) instead of `Date.now()`. Millisecond rounding used to collapse a whole unit of work onto one instant — a `START TRANSACTION`, its `INSERT` and its `COMMIT` all at `+1ms` — which left the waterfall unable to order or nest them; durations are reported with the decimals that resolution buys.

Spans no longer nest under a leaf operation by time containment: two outgoing calls fired concurrently (`Promise.all`) stay siblings instead of the longer one adopting the shorter. Only containers — the request, a lifecycle phase, a GraphQL field, or a span a producer marks with `container: true` — adopt children by time; a leaf gets children only through an explicit `parentId`.

SQL collectors wrap each `BEGIN … COMMIT/ROLLBACK` run in a synthetic `transaction` span covering the whole unit of work, with its statements nested underneath and its boundaries in execution order.

A parent is widened onto its children when it stopped being timed before the work it triggered resolved, so a container never renders as a misleadingly cheap bar over visibly longer work. Durations render in the unit that fits them — nanoseconds, microseconds, milliseconds, seconds, then minutes and hours — so a short operation is never rounded into a misleading `0ms`, and a long-running command reads as `2m 5s`, and the Timeline panel now states which spans are containers — they overlap their children rather than adding to them, which is why the `% of total` column does not sum to 100%.
