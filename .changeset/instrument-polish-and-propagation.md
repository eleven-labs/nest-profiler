---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-http': minor
---

Raise the `@nestjs/core` peer to `^11.1.4`, forward the trace id on outgoing calls, and make the trace lens reach the table under the waterfall.

- **`@nestjs/core` peer is now `^11.1.4`**, the first release carrying the `instrument` option on `NestFactory`. A peer range only warns at install, so `createProfilerInstrument()` also checks the resolved version and says so once — on an older Nest the option is ignored and the feature is _silently_ inert, which is the worst failure mode for a debugging tool.
- **`propagateTraceId`** on `HttpCollectorModule` forwards the profile's trace id on every instrumented outgoing call (`true` for `x-request-id`, or a header name). Off by default: adding a header to an application's outgoing traffic is a visible change. A header the caller set explicitly always wins, and nothing is added outside a profiled request.
- **The Execution Trace lens now filters the table below the bars**, not only the bars. "I/O only" used to hide the method bars and still list every one of them underneath. Rows carry the same span id, so folds reach them too, and a count appears when you are looking at a subset.
