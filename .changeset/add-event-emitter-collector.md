---
'@eleven-labs/nest-profiler-event-emitter': minor
---

New package: profile the domain events an application dispatches through `@nestjs/event-emitter`.

`EventEmitterCollectorModule.forRoot()` patches the app's `EventEmitter2` (`emit` and `emitAsync`) and contributes three surfaces. An **Events** panel on the emitting profile lists every emission with its listener count, duration, async flag and redacted payload — an emission with zero listeners is flagged, and the entries feed the performance-rule engine under a dedicated `event` tag domain (`slowThreshold`, `nPlusOneThreshold`, `chattyThreshold`, `slowSeverity`). An **Event Listeners** group in the Routes panel lists every `@OnEvent` subscription discovered across providers and controllers. And, unless `profileListeners` is off, each `@OnEvent` execution becomes its own `event` profile (`entrypoint.type = 'event'`, with the event name, provider, method and payload on `entrypoint.data`) carrying the logs, queries and outgoing HTTP calls that ran inside the handler — rendered in a dedicated **Events** list table with **Status** and **Event** filters, and an **Event** detail tab. Failed executions are classified through the standard `error` option (`ProfilerErrorOptions`). Options: `enabled`, `capturePayload`, `maxPayloadLength`, `ignoreEvents`, `emitterToken`, `profileListeners`, `slowThreshold`, `nPlusOneThreshold`, `chattyThreshold`, `slowSeverity`, `error`.

Request-scoped subscribers are not profiled: `@nestjs/event-emitter` resolves a fresh instance per event, so there is no stable handler to wrap.
