---
'@eleven-labs/nest-profiler-rabbitmq': minor
---

Link a consumed message to the request that published it: `RabbitMqPublishCollectorModule`'s new `propagateTraceId` option stamps every message published while a profile is active with the trace id header, and `RabbitMqCollectorModule` adopts it (header name set by the new `traceIdHeader` option), so the detail page lists both profiles under one trace.
