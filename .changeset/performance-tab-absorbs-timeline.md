---
'@eleven-labs/nest-profiler': minor
---

Merge the Timeline tab into **Performance**, and show the execution timeline only when spans were recorded.

The Timeline tab badged the request duration and, for the vast majority of profiles, rendered nothing but "No spans recorded. Use profilerService.startSpan('phase') to instrument your code." — an empty tab restating what the Performance tab already owned. The **Performance** tab now carries the whole timing story: it is badged with the total duration, keeps the duration / process-heap cards and the start-end **Timestamps**, and appends the **Execution timeline** (synchronized bars plus the per-phase table) when — and only when — the profile actually recorded spans. A profile with no span shows no timeline at all.

The `timeline.png` screenshot is retired with the tab — the regenerated `performance.png` now carries the spans, so the two would have been the same shot of the same profile.

`TimelineCollector` is removed from the public API: it only forwarded `profile.spans`, which the Performance tab reads directly, so nothing consumed it. Custom timeline instrumentation is unchanged — `ProfilerService.startSpan(...)` still records spans, and `profile.spans` still carries them in the exported JSON.
