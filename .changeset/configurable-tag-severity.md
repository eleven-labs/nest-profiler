---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-typeorm': minor
'@eleven-labs/nest-profiler-mikro-orm': minor
'@eleven-labs/nest-profiler-mongoose': minor
'@eleven-labs/nest-profiler-http': minor
---

Make the severity of every threshold-based performance tag configurable per collector, and drive all severity colouring in the UI from the tag's actual severity.

Each query/HTTP collector now accepts flat severity options alongside its thresholds: `slowSeverity`, `nPlusOneSeverity`, `chattySeverity`, `zeroRowsSeverity` (query collectors) and `slowSeverity`, `nPlusOneSeverity`, `chattySeverity`, `largePayloadSeverity` (HTTP). Each defaults to today's value (`slow`/`chatty`/`large-payload`/`zero-rows` → `warning`, `n-plus-one` → `danger`); `error` stays `danger` and is not configurable. `TagConfig` gains the matching optional fields.

The dashboard now colours the query/HTTP panels consistently: the duration text, the "slow" sublabel, the summary "N slow" / "N N+1" counts, the row highlight and the badge pill all follow the tag's severity. Previously `slow` (a `warning`) was rendered red in the duration column and summary while its pill was amber; a missing `warning` background token also left the slow-row highlight invisible. New `warning` / `info` semantic colour tokens back this.

Note: because colouring now follows severity, raising a tag's severity (e.g. `slowSeverity: 'danger'`) intentionally turns its duration text, counts, row highlight, pill and the performance banner red.
