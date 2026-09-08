---
'@eleven-labs/nest-profiler': minor
---

New `timezone` option: choose the timezone the UI renders timestamps in.

Pages are rendered server-side, so timestamps were always projected into the timezone the process runs in — the one `TZ` selects, or the system zone when `TZ` is unset. That is right on a developer machine and wrong as soon as the application and the reader differ (a `TZ=UTC` container shows UTC times to someone in Paris). `ProfilerModule.forRoot({ timezone: 'Europe/Paris' })` now sets the display zone; any IANA name works, and an unknown one logs a warning and falls back to the host timezone. The effective timezone is displayed in the dashboard header ("Times in Europe/Paris"), so a time on screen is never ambiguous even when nothing is configured. Only rendering is affected — stored profiles keep their epoch timestamps and the JSON export is unchanged.
