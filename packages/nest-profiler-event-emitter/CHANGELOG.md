# @eleven-labs/nest-profiler-event-emitter

## 1.0.0-alpha.19

### Major Changes

- e3b057e: Fixes to the HTTP phase timer and the event-emitter collector found in review.

  - **Socket listener leak on keep-alive connections.** `instrumentClientRequest` attached `lookup`/`connect`/`secureConnect` listeners to the socket and relied on them removing themselves when they fired. On a pooled socket those events never fire again, so nothing consumed them: `MaxListenersExceededWarning` landed on the 11th request through one connection, and every retained closure kept that request's marks alive for the life of the socket. Node >= 19 keeps `http.globalAgent` alive by default, so this was the ordinary path. The listeners are now detached when the request can no longer produce a connection phase.
  - **BREAKING: a handler carrying several `@OnEvent` decorators is named after all of them.** The method is wrapped once, so the wrapper cannot know which subscription fired — `@nestjs/event-emitter` registers it as `(...args) => instance[method](...args)`. It previously reported the alphabetically first event, mislabelling every profile produced by the others (including the `attributes.event` facet the Events filter queries). Such profiles are now filed under `"a, b"`. Split the method in two to keep them apart.
  - **A synchronous `@OnEvent` handler stays synchronous.** The wrapper always returned a promise, so a sync handler that threw produced a rejected promise instead: `emit()` discards a listener's return value, so the emitter's `try`/`catch` never saw the failure (it went missing from the emitting profile's Events panel, contradicting what `suppressErrors: false` promises) and Node terminated the process on the unhandled rejection. The awaited path is unchanged.
  - **Event profiles now carry a trace and a version.** The collector ran `collectAll` and `storage.save` by hand instead of `ProfilerCoreService.persist`, skipping the version stamp and the trace assembly — so an event profile reached storage with an empty waterfall.
  - **The emitter's configured `delimiter` is honoured.** An array-form `@OnEvent(['order', 'created'])` was always joined with a dot, naming the subscription `order.created` under an emitter that dispatches `order/created`.
  - The Payload section of the event detail page emitted its `class` attribute HTML-escaped, so its spacing never applied; and an entry carrying only an error offered an expand chevron that unfolded to "No payload captured for this event" — the error is already shown on the row.
  - `UndiciPhases.install()` counted a phase-slot provider before its own idempotency guard, so a second application lifecycle in one process inflated the counter while the subscriptions stayed at one.

## 1.0.0-alpha.18

### Minor Changes

- 31d54c3: New package: profile the domain events an application dispatches through `@nestjs/event-emitter`.

  `EventEmitterCollectorModule.forRoot()` patches the app's `EventEmitter2` (`emit` and `emitAsync`) and contributes three surfaces. An **Events** panel on the emitting profile lists every emission with its listener count, duration, async flag and redacted payload — an emission with zero listeners is flagged, and the entries feed the performance-rule engine under a dedicated `event` tag domain (`slowThreshold`, `nPlusOneThreshold`, `chattyThreshold`, `slowSeverity`). A **Discover / Events** view lists every `@OnEvent` subscription discovered across providers and controllers, with the options (`async`, `prependListener`) it registered with. And, unless `profileListeners` is off, each `@OnEvent` execution becomes its own `event` profile (`entrypoint.type = 'event'`, with the event name, provider, method and payload on `entrypoint.data`) carrying the logs, queries and outgoing HTTP calls that ran inside the handler, and continuing the emitter's `traceId` so the handler correlates with the request that published the event — rendered in a dedicated **Events** list table with **Status** and **Event** filters, and an **Event** detail tab. Failed executions are classified through the standard `error` option (`ProfilerErrorOptions`). Options: `enabled`, `capturePayload`, `maxPayloadLength`, `ignoreEvents`, `emitterToken`, `profileListeners`, `slowThreshold`, `nPlusOneThreshold`, `chattyThreshold`, `slowSeverity`, `error`.

  Request-scoped subscribers are not profiled: `@nestjs/event-emitter` resolves a fresh instance per event, so there is no stable handler to wrap.
