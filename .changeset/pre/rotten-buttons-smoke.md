---
'@eleven-labs/nest-profiler': patch
---

Render profile timestamps in the host timezone instead of UTC.

The `isoDate` / `timeOnly` template helpers formatted epoch milliseconds with `toISOString()`, so every date shown in the UI — the list sections, the detail header, the timeline, the log/exception rows and every collector panel (SQL, Mongoose, HTTP client, cache, validator, RabbitMQ) — was shifted by the host's UTC offset (a profile captured at 20:00 in `Europe/Paris` displayed as 18:00), while the Config panel reported the runtime timezone. They now format in the timezone the process runs in, so the times shown match the reported timezone.
