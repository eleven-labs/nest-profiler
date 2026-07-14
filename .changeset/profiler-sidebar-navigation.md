---
'@eleven-labs/nest-profiler': minor
---

Rework the profiler home page into a two-column, sidebar-navigated layout.

The home page (`GET /_profiler`) now uses the detail page's two-column layout — a sticky left sidebar of **views** and a right content pane — with the active view selected server-side from a `?view=` query parameter (plain links, no client JS, consistent with the `script-src 'self'` CSP).

Each entrypoint kind is its own dissociated page under a **Profiling** group: the sidebar lists HTTP, GraphQL, Commands, RabbitMQ… as sub-items (defaulting to the HTTP catch-all), and each renders only its own list section, filters, pager and the process-heap trend. Every global-scope collector (Config, Routes, Schemas…) is a view too. Every sidebar item carries a **count badge** — a list section shows its unfiltered profile total, and a global panel shows its own count (taken by convention from the first `*Count` field its data exposes, e.g. `routeCount`). `GlobalPanelInfo` gains an optional `badge` computed by `CollectorRegistry.buildGlobalPanels()`.

Each list section renders an **empty-state row** when it has no profiles (every kind is now always reachable as its own page), the detail page gains a **back link** to the list view of the profile's kind (e.g. back to the GraphQL list from a GraphQL profile), and the now-redundant "All Profiles" header link is dropped (the sidebar covers navigation).

The two-column layout is responsive: it stacks to a single column on small screens (the sidebar moves to the top, full-width) and becomes the sticky two-column layout from `md` up — applied identically to the home page and the profile detail page so both read as one system on mobile.
