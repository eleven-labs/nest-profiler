---
'@eleven-labs/nest-profiler': minor
---

Let a global-scope collector expand into several sidebar views, and file related views under a group heading.

`IProfilerCollector` gains an optional `expandGlobalPanels(data)` returning one `GlobalPanelDescriptor` per view — a `scope: 'global'` collector whose snapshot holds several independent subjects now becomes several sidebar views instead of one panel aggregating them. It receives the value `collect()` returned, so timeout and error handling are unchanged, and each descriptor only carries what differs from its collector (group, icon, template and priority are inherited). Returning an empty array hides the collector entirely, so an installed package with nothing to show adds no empty view.

A global collector's `group` / `groupLabel` — previously read only for per-request panels — now files its sidebar view under that heading, and the panel header restates the group so a short label stays unambiguous (`Schemas / TypeORM`). Ungrouped views stay flat at the end of the sidebar. Global views are also ordered by collector priority, instead of by DI discovery order.

`RouteGroup` gains an optional `itemLabel`, the singular noun a route source uses for its own entries, so a routing table counts `3 commands` rather than `3 routes` (defaults to `route`).
