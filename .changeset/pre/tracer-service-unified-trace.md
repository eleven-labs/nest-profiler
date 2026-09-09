---
'@eleven-labs/nest-profiler': major
'@eleven-labs/nest-profiler-rabbitmq': major
'@eleven-labs/nest-profiler-commander': major
---

BREAKING: replace `ProfilerService` with `TracerService`, and reduce spans to a single model.

- `TracerService` replaces `ProfilerService` and `NoopProfilerService`, which are removed with no alias. It injects only optional dependencies, so the same class is the documented no-op when the profiler is disabled — there is no second implementation to keep in sync.
- `@Span(name?)` records a whole method as one span without touching its body — same nesting and error marking as `span()`, but one line, no re-indentation, and `return` keeps meaning "return from the method". It needs no injection: like `createProfilerLogger`, it resolves the active profile from the CLS store. The name defaults to `ClassName.methodName`.
- `span(name, work)` runs the work inside a span, closes it however it ends, and marks it failed when it throws. Work issued underneath reports it as its parent through the CLS store, so nesting is exact rather than inferred from overlapping time windows.
- `startSpan(name)` now returns a `TraceSpanDelegate` carrying `end()`, `setTag()` and `addTags()` instead of a close function.
- `captureError(error, tags?)` records an error the application caught itself, marked `handled` so a request that recovered is not counted as a failure.
- `setAttribute()` / `getAttribute()` write to `Profile.attributes`, so a value set from application code is indexed and filterable from the profile list.
- `Profile.trace` replaces `Profile.spans`: one flat, `parentId`-linked `TraceSpan` list assembled by `buildTrace()` after collection. `TimelineSpan`, `LifecyclePhase` and `Profile.lifecycle` are removed; lifecycle phases are spans with `lane: 'lifecycle'`.
- `Profile.traceId` replaces `HttpRequestData.requestId` and applies to every entrypoint kind. It adopts the `traceIdHeader` (default `x-request-id`) when the caller sent a usable value, and is length- and charset-validated before adoption, since it reaches log lines, the dashboard and outgoing headers.
- New options `traceIdHeader` and `attachTraceIdToLogs` (default `true`); `createProfilerLogger` prefixes forwarded messages with the trace id and stamps `LogEntry.spanId`.
- The RabbitMQ adapter adopts the message's `correlationId` as the trace id, linking a consumed message to the request that published it.
