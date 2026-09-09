---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-commander': patch
'@eleven-labs/nest-profiler-rabbitmq': patch
'@eleven-labs/nest-profiler-graphql': patch
---

Measure every duration on a monotonic clock, with sub-millisecond resolution.

Elapsed time — the request duration and every timeline span — was computed from `Date.now()`, which is both millisecond-granular and non-monotonic. Two consequences: any span shorter than a millisecond reported `0ms`, which is most application work and made the execution timeline unusable for comparing phases; and a wall-clock adjustment mid-request (an NTP step) produced a wrong duration, a backward step a **negative** one, which then flowed into the `slow` performance rule, the duration list filter and the stored profile summary.

- `PerformanceData.duration` and `TimelineSpan.duration` are now measured with `performance.now()` and carry up to three decimals (`0.42`, `1.618`). They are clamped at `0`, so a duration can never be negative.
- Absolute timestamps are unchanged and stay on the wall clock, because they are what a reader needs: `performance.startTime`, `TimelineSpan.startedAt`, `createdAt` and every log/exception timestamp remain epoch milliseconds.
- The HTTP middleware now reads the clock **once**: `createdAt` and `performance.startTime` named the same instant through two separate `Date.now()` calls and could disagree by a millisecond.
- New `formatDuration` view helper, applied to every duration the UI renders (profile header and Performance tab, the execution timeline, and the HTTP / GraphQL / Command / RabbitMQ list and detail views). It trades precision against magnitude — two decimals below 10 ms, one below 100 ms, whole milliseconds above — trims trailing zeros, and renders `<0.01` for a value too small to show rather than a misleading `0`.
- New exports: `monotonicNow`, `elapsedMs`, `markProfileStart`, `profileElapsedMs`, `formatDuration`. A package contributing its own entrypoint kind calls `markProfileStart(profile)` when it builds the profile to opt into monotonic measurement; a kind that does not falls back to the wall-clock difference, clamped at zero.

No migration and no storage change: SQLite's numeric affinity preserves a fractional value in the existing `duration INTEGER` summary column, on existing databases as well as new ones (covered by a test).

Anything reading `performance.duration` or `span.duration` programmatically — a custom performance rule, a custom collector panel, an assertion in a test — now receives a fractional number where it used to receive an integer.
