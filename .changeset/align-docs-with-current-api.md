---
'@eleven-labs/nest-profiler': patch
'@eleven-labs/nest-profiler-http': patch
---

Documentation-only pass aligning every guide, README and agent skill with the current API.

Corrected what no longer matches the code: the `slowQueryThreshold` option (renamed `slowThreshold`) in the root README and the example app, the `HttpCollectorModule.forRootAsync({ axiosRef })` snippet in Getting started (adapters are now selected through `instrumentations`, and the axios one auto-discovers every `HttpService`), the non-existent `ProfilerViewsSetup` export, the removed **Timeline** tab (the breakdown is drawn in the Performance tab's **Execution Trace**), and the claim that the inert layer binds a separate no-op service — `TracerService` is registered with none of its optional dependencies, which is what makes it a no-op. Dropped the migration and deprecated-option notes: nothing has shipped stable, so there is no older way worth documenting.

Filled the gaps left by recent features: `createProfilerInstrument` / `ProfilerInstrumentOptions` and the trace helpers now appear in the core API reference, the `event` kind is listed in the error-classification table, the event-emitter and RabbitMQ-publish domains in the performance-tag thresholds, the `zero-rows` tag in the tag filter and the skill, and the `routes`, `rabbitmq` and `event-emitter` packages in the package tables, tutorial index and Profiler UI tour.
