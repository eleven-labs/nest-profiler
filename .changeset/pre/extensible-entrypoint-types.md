---
'@eleven-labs/nest-profiler': minor
---

Make the kind of thing a profile describes — an HTTP request, a CLI command, a consumed message… — a first-class, extensible **entrypoint type**, so a package can add a new kind (its own list table, detail tab, scoped list filters and breadcrumb summary) in a single call without touching the core.

- New discriminated profile model: `Profile.entrypoint = { type, data }` replaces the overloaded `Profile.request`. HTTP/GraphQL data moves to `entrypoint.data` (the renamed `HttpRequestData`); `RequestData` is removed.
- New `ProfilerCoreService.registerEntrypointType()` plus the `ProfilerEntrypointType`, `ProfilerDetailTab` and `EntrypointSummary` contracts (and the `PROFILER_ENTRYPOINT_TYPES` token). The controller resolves the detail tabs, list section and breadcrumb summary from the active entrypoint type — the hard-coded per-kind branching is gone.
- The core now ships only the built-in `http` entrypoint type for REST requests; `CommandInfo` and the Commands table/tab move to `@eleven-labs/nest-profiler-commander`, GraphQL becomes its own `graphql` type in `@eleven-labs/nest-profiler-graphql`, and further entrypoint kinds live in their own packages. Each kind's list has its own filter bar (universal filters plus the kind's scoped filters via `listFilters`); there is no longer a global `type` filter.
- Collector `scope: 'request'` is renamed to `scope: 'profile'` to reflect that profile-scoped collectors (database, cache, HTTP client…) attach to **any** entrypoint, not just HTTP requests. `'profile'` is the default, so collectors that don't set a scope are unaffected.
- Every list section now renders inside a collapsible `<details>`/`<summary>` disclosure (bordered card with a hoverable header, matching the global panels): the summary keeps the title and count badge visible while the table and filter bar fold away. Sections are expanded by default; a section (or an entrypoint type's `listSection`) can set `defaultCollapsed: true` to start folded.
