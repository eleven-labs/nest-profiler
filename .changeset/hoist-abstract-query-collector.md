---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-mongoose': patch
'@eleven-labs/nest-profiler-typeorm': patch
'@eleven-labs/nest-profiler-mikro-orm': patch
---

Hoist a shared `AbstractQueryCollector` and harden the multi-ORM Database panel.

- New ORM-agnostic `AbstractQueryCollector<TEntry>` in the core barrel owns the shared `Nq (M slow)` badge and the collect flow (drain the private `queriesKey`, delete it, then run a `transform` hook). `AbstractSqlQueryCollector` now only pins the SQL panel template; `MongooseCollector` drops its hand-rolled `getBadgeValue`/`collect` and keeps just its `queriesKey`, template path, and a `transform` override (attaching the runnable mongo `command`).
- The TypeORM and MikroORM collectors now expose distinct panel labels (`TypeORM` / `MikroORM`) instead of a shared `SQL`, so their sub-tabs stay identifiable when several ORMs share the **Database** group (e.g. TypeORM + Mongoose in the same app). No change when a single SQL ORM is used.
