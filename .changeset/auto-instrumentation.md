---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-validator': patch
---

Add optional automatic instrumentation: one span per provider method call, so the Performance tab shows the full call tree — which controller called which service, which called which repository, and what each cost.

`createProfilerInstrument()` builds the `instanceDecorator` that `NestFactory` accepts through its `instrument` option (requires `@nestjs/core` 11.1.4+). It is **off by default and belongs in development**: it proxies every provider instance, so every property access goes through a trap whether or not the request is profiled.

- Spans carry `kind: 'method'` and go into the same `Profile.trace` as everything else, so a query is nested under the repository method that issued it.
- The Performance tab gains a lens over that one tree — **All / I/O only / Code only** — rather than a second panel, so hiding method rows leaves their children attached to their real parent.
- The profiler's own providers and `ClsService` are excluded automatically. Without that, one request produced 75 spans of which about a dozen were application code; `includeInternals: true` opts back in, for debugging the profiler itself.
- `skip(instance)` excludes a provider, `maxDepth` (default 20) bounds the tree's depth. Recursion is handled separately by a re-entrancy guard.
- Instances a Proxy would break are handed back untouched: bare built-ins (`useValue: new Map()`), callable objects (a Mongoose model, an Axios instance), classes, and anything whose prototype cannot be read. Classes with native private members and built-in subclasses run against the raw receiver so their brand checks and internal slots keep working.
- New exports: `createProfilerInstrument`, `ProfilerInstrumentOptions`, `markInternal`, `isInternal`.
