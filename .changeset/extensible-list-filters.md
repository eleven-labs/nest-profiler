---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-graphql': minor
---

Make the profiler list filters extensible (universal filters plus per-kind scoped filters, each list with its own filter bar) plus default ignore paths.

`@eleven-labs/nest-profiler`:

- New extensible filter system: filters are `ProfilerListFilter` definitions (key, label, control, `parse`, `matches`) registered via `ProfilerCoreService.registerListFilter()` or the `PROFILER_LIST_FILTERS` multi-token. Each list (HTTP, GraphQL, Commands…) renders its own filter bar with the universal filters plus the filters scoped to its kind; a kind's filters apply only to its own table, and query params are namespaced by section.
- Built-in **universal** filters shown above every list: **status** and **status class** (2xx/3xx/4xx/5xx), **min/max duration**, a **With exceptions** checkbox, and a **global search** (URL + GraphQL operation name + command name). The HTTP **method** filter is now scoped to the HTTP list.
- Default ignore paths: `/favicon.ico`, `/robots.txt`, `/.well-known/appspecific/com.chrome.devtools.json` and `/apple-touch-icon*` are skipped by default; opt out with the new `useDefaultIgnorePaths: false` option.
- List filtering now runs in the controller over `storage.findAll()`; custom storage adapters no longer receive the list query as `StorageFindOptions` (the `findAll(options)` signature is unchanged for direct callers).

`@eleven-labs/nest-profiler-graphql`:

- Contributes an **Operation** filter (query / mutation / subscription) shown above the GraphQL list.
