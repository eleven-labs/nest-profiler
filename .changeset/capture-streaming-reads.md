---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-typeorm': minor
'@eleven-labs/nest-profiler-mongoose': minor
'@eleven-labs/nest-profiler-mikro-orm': minor
---

Capture streaming reads (TypeORM `stream()`, Mongoose `cursor()`, MikroORM `stream()`) that previously bypassed or under-reported in the query collectors.

- `nest-profiler`: add an optional `streaming` flag to `QueryEntry` and render a `stream` badge in the SQL panel; streaming reads whose duration could not be measured are labelled `not timed (stream)` in the Duration column.
- `nest-profiler-typeorm`: wrap `QueryRunner.stream()` alongside `query()`. Duration is measured non-intrusively from the stream's terminal `end`/`close`/`error` events — no `data` listener, so no rows are diverted from the caller; entries are flagged `streaming: true`. Streamed row counts are not captured.
- `nest-profiler-mongoose`: patch `Query.cursor()` and `Aggregate.cursor()`, which bypass `exec()`. The read is recorded at cursor creation (flagged `streaming: true`) so it is captured whatever the consumption pattern; duration is finalized from terminal events for flowing / `pipe()` / explicit `close()`, and stays `0` for `for await` / `eachAsync()` (which emit no terminal event) — a documented limitation.
- `nest-profiler-mikro-orm`: detect streaming reads (a `SELECT` logged without `took`) and flag them `streaming: true`. Their `duration` stays `0` since MikroORM logs the query before consuming rows; measuring it would require wrapping the internal row generator.
