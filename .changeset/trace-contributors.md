---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-http': minor
'@eleven-labs/nest-profiler-cache': minor
'@eleven-labs/nest-profiler-mongoose': minor
---

Fill the trace waterfall with the work the collectors already capture.

- `appendCollectorEntry()` — the single funnel every instrumentation in every package goes through — now stamps each entry with the trace span that was open when it was captured. The parent is therefore exact rather than inferred from overlapping time windows, which is what makes it right under concurrency: two calls fired together no longer nest under one another.
- New `TraceContributor` implementations project already-collected entries onto the trace: every query collector (TypeORM, MikroORM, Mongoose) through `AbstractQueryCollector`, plus the HTTP-client and cache collectors. Nothing is re-timed — the shared `entriesToSpans()` helper reads the `startedAt`, `duration`, tags and parent each entry already carries.
- Each bar links back to the row holding its detail, and a grouped collector links to its group panel (`database`) rather than to itself.
- The HTTP collector classifies a failed bar with its own `error` option, so a 404 reddens only where the application says it should.
- New exports: `entriesToSpans`, `EntrySpanOptions`. Entry interfaces gain `parentSpanId`.
