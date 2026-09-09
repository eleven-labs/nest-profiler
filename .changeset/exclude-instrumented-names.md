---
'@eleven-labs/nest-profiler': minor
---

Add `exclude` to `createProfilerInstrument()`: classes and methods to keep off the Execution Trace, named rather than filtered by predicate. Recording every provider method call also records the boring ones — a `ConfigService.get` read two hundred times a request, a `getRequestId` called from every layer — and together they bury the dozen spans the trace was opened for.

```ts
instrument: createProfilerInstrument({
  exclude: ['ConfigService', 'ClockService.now', '*.getRequestId', /Repository$/],
});
```

- The dot tells the two levels apart: a pattern matching a **class name** takes the provider off the trace entirely — handed back unproxied, so it costs nothing at all — while one matching a **`Class.method`** label drops that method and leaves the rest of the class recorded.
- Strings match in full, so `'Product'` never takes `ProductRepository` with it, and `*` is a wildcard within a name that never crosses the dot — which is what keeps `'*.get'` a method pattern rather than a way of matching everything.
- A RegExp is tried at both levels, so its own anchoring says which it meant: `/Repository/` drops every repository, `/^AppService\.tick$/` one method. The `g` and `y` flags are stripped, since `test` on either advances `lastIndex` and would record a provider or not depending on what ran before it.
- Excluding a method never orphans its children: they reparent to whatever span was active above it, exactly as an anonymous wrapper's do, so the tree keeps its shape and loses only the row you asked it to lose.
- `skip(instance)` is unchanged and still the answer for what a name cannot express; both apply together.
