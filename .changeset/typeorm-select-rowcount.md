---
'@eleven-labs/nest-profiler-typeorm': patch
---

Capture `rowCount` for `SELECT` queries run through TypeORM's QueryBuilder / repository methods.

- TypeORM 0.3 reads call `queryRunner.query(sql, params, useStructuredResult=true)`, which returns a structured `QueryResult` (`{ records, raw, affected }`) instead of a plain array. For a `SELECT` `affected` is `undefined`, so `deriveRowCount` matched none of its branches and left `rowCount` empty in the Database panel.
- `deriveRowCount` now falls back to the `records` array (then `raw`) of a structured `QueryResult`, so reads report their returned-row count the same way writes report `affected`. Writes that expose `affected`/`rowCount`/`changes` are unchanged and still take priority.
