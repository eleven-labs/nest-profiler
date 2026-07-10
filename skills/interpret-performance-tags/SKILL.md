---
name: interpret-performance-tags
description: |
  Read and act on @eleven-labs/nest-profiler performance tags (slow, n-plus-one, chatty, large-payload, error), tune the thresholds that produce them, and add custom performance rules.
  Use when a user asks what a profiler tag means, why a request is flagged, how to fix an N+1 / slow / chatty pattern, or how to change or extend the tagging rules.
---

# Interpret performance tags

After every profile is collected, the analysis engine runs performance rules and attaches **tags** to entries and to the profile. The built-in rules are `slow`, `n-plus-one`, `error`, `chatty`, and `large-payload`. This skill explains what each means, how to fix it, how to tune the thresholds, and how to add domain-specific rules. Assumes the core profiler is set up.

## The built-in tags

| Tag             | What it means                                                    | Where the threshold lives                                                   | Typical fix                                                           |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `slow`          | A single operation took ≥ `slowThreshold`.                       | Per collector: ORM `slowThreshold` (100 ms), HTTP `slowThreshold` (300 ms). | Add an index, cache the call, reduce payload, parallelize.            |
| `n-plus-one`    | The same query/call ran ≥ `nPlusOneThreshold` times (identical). | Per collector: `nPlusOneThreshold` (ORM/HTTP default 2).                    | Eager-load / join / batch (DataLoader), or a single `IN (...)` query. |
| `chatty`        | A request issued ≥ `chattyThreshold` total operations.           | Per collector: `chattyThreshold` (ORM 20, HTTP 10).                         | Batch, cache, or restructure to fewer round-trips.                    |
| `large-payload` | An HTTP payload was ≥ `largePayloadThreshold`.                   | HTTP `largePayloadThreshold` (1 MB; `0` disables).                          | Paginate, compress, select fewer fields.                              |
| `error`         | The operation or request errored.                                | Built-in (no threshold).                                                    | Fix the underlying failure; check the Exceptions tab.                 |

Read them in the UI: a collector's nav tab is coloured by its worst tag severity (`getBadgeSeverity`), and each entry carries its tags. Start from the profile-level tags, then drill into the flagged collector panel.

## Tuning thresholds

Thresholds are **per collector**, passed to each collector's `forRoot` / `forRootAsync` (drive them from `ConfigService` for env control). Raise a threshold to silence noise on a known-acceptable pattern; lower it to catch regressions earlier. Example: `TypeOrmCollectorModule.forRoot({ slowThreshold: 50, nPlusOneThreshold: 3 })`. See the collector family references in `setup-nest-profiler` for every option.

Note: raising a threshold only **changes when the tag fires** — it does not make the operation faster. Use it to calibrate the signal (e.g. a slow local DB in dev), not as a substitute for fixing a genuinely slow query or an N+1.

## Adding a custom rule

Append `PerformanceRule`s via the core `performance.rules` option (or `ProfilerCoreService.registerPerformanceRule`). A rule has an `id` and `evaluate(ctx)`; it reads `ctx.collectors` (grouped taggable entries) and calls `ctx.tagEntry(entry, tag)` / `ctx.tagProfile(tag)`. It runs synchronously and must not throw.

```ts
ProfilerModule.forRoot({
  isGlobal: true,
  performance: {
    rules: [
      {
        id: 'too-many-writes',
        evaluate(ctx) {
          for (const c of ctx.collectors) {
            const writes = c.entries.filter((e) =>
              /INSERT|UPDATE|DELETE/i.test(String((e as any).query)),
            );
            if (writes.length > 5)
              ctx.tagProfile({ id: 'too-many-writes', label: 'Many writes', severity: 'warning' });
          }
        },
      },
    ],
  },
});
```

To make a **custom collector** feed the engine, implement `TaggableCollector` (see the `custom-collector` skill).

## Verify

Reproduce the flagged request, confirm the tag appears (or disappears after a threshold change / fix), and check the profile-level tag aggregation on the list page.

Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/performance-tags>
