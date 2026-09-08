---
'@eleven-labs/nest-profiler': patch
---

Keep detail-page navigation items active when they carry content but expose no counter, instead of dimming them like disabled tabs.

Entrypoint tabs (Request/Response, GraphQL, Command, Message) have no badge function, and grouped collector panels may lack a counter too. Both paths coerced the absent badge to `null`, which the sidebar treats as "no data" and dims. The badge is now kept `undefined` in those cases (only an explicit `null` from `getBadgeValue`/`badge` still means "no data"), so tabs and groups that always have content render active.
