---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-typeorm': minor
'@eleven-labs/nest-profiler-mikro-orm': minor
---

Add on-demand SQL `EXPLAIN` plan analysis to the Database panel.

Every query in the SQL panel now has an **Explain** button. Clicking it runs `EXPLAIN` for that single query over the ORM's own connection and renders the execution plan inline — top plan node, a warning when the plan does a full-table (sequential) scan, the scanned relations, estimated rows/cost, and the raw plan. Supported dialects: PostgreSQL, MySQL/MariaDB and SQLite.

The analysis runs **on demand only** — nothing executes until a user clicks — so it adds no latency to the profiled request. `EXPLAIN` alone does not execute the statement; the opt-in `analyze` variant (`EXPLAIN ANALYZE`) does, and is restricted to `SELECT`.

- core: new `ExplainRunnerRegistry`, dialect-aware `parseExplainPlan` helper, `ExplainOptions`/`ExplainPlan`/`ExplainRunner` types, a secured `GET /_profiler/:token/explain/:collector/:index` route rendering the plan fragment, and the SQL panel UI (Explain button, seq-scan badge, collapsible raw plan).
- `nest-profiler-typeorm` / `nest-profiler-mikro-orm`: new `explain?: ExplainOptions` module option (default `{ enabled: true }`) and an EXPLAIN runner that executes over the DataSource / EntityManager connection and registers with the core registry.
