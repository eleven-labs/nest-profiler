---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-typeorm': minor
'@eleven-labs/nest-profiler-mikro-orm': minor
'@eleven-labs/nest-profiler-mongoose': minor
---

Capture the row count and connection metadata of every database query, and flag silent zero-row writes.

- `nest-profiler`: add optional `rowCount`, `connection` (`host:port`, no credentials) and `database` to `QueryEntry`; the SQL panel renders a per-query metadata line (`42 rows @ localhost:5432 / shop`) and a "rows read" total in the header. A new built-in `zero-rows` performance rule tags a SQL `UPDATE`/`DELETE` with `rowCount === 0` (and a Mongoose `delete`/`update` with `count === 0`) as a silent failure — it surfaces as an amber pill, highlights the row, colours the Database tab and is selectable in the list page's performance-tag filter. Empty reads and writes whose row count could not be captured are never flagged.
- `nest-profiler-typeorm`: derive `rowCount` best-effort from the driver result (array length, or `affected`/`rowCount`/`affectedRows`/`changes`) without altering it; read `connection`/`database` once from the DataSource options (omitted for drivers with no host/port, e.g. sqlite). Streamed reads still capture no row count.
- `nest-profiler-mikro-orm`: capture `rowCount` from the log context (`affected` for writes, `results` for reads) and `connection`/`database` from the ORM config (`host`/`port`/`dbName`), falling back to the log context's connection name.
- `nest-profiler-mongoose`: expose `connection`/`database` from the mongoose Connection on every captured operation; the existing `count` (documents returned/affected) drives the zero-row parity for `delete`/`update` writes.
