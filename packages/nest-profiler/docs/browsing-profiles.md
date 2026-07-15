Every profiled execution receives a unique token and lands in the profiler UI. This page is the **reference** for the endpoints that expose the collected data, the debug headers that link a response to its profile, the list filters, and how to export a profile.

![Profiler UI — the sidebar of views with count badges, and the HTTP list with its filter bar](../../../docs/public/screenshots/profiler/profiles-list.png)

## Profiler UI endpoints

| Endpoint                     | Description                         |
| ---------------------------- | ----------------------------------- |
| `GET /_profiler`             | Home page — profiles + views (HTML) |
| `GET /_profiler/:token`      | Profile detail page (HTML)          |
| `GET /_profiler/:token/data` | Raw profile data (JSON)             |

## Home page navigation

The home page uses the same two-column layout as the detail page: a sticky left sidebar lists the available **views**, and the active one is selected server-side from a `?view=` query parameter (plain links, no client-side routing — consistent with the profiler's `script-src 'self'` CSP).

Each entrypoint kind is its own dissociated page under a **Profiling** group, and every global-scope collector is a view too:

| View                       | `?view=`                | Content                                                                    |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| HTTP (default)             | `http`                  | The HTTP list, its filters, its pager and the process-heap trend           |
| GraphQL / Commands / …     | the section key         | One page per registered list section (each with its own filters and pager) |
| Config / Routes / Schemas… | the global panel's name | One entry per installed global-scope collector, rendered on demand         |

Every sidebar item carries a **count badge**: a list section shows its unfiltered profile total, and a global panel shows its own count (the first `*Count` field its data exposes, e.g. `routeCount`). The `?view=` parameter coexists with the list filters, so a filtered link keeps its view: `GET /_profiler?view=http&http_method=POST`. Global panels (Config, Routes, DB schemas…) are sidebar destinations rather than inline `<details>` blocks.

## Debug headers

Every non-profiler request receives response headers:

| Header               | Value                        |
| -------------------- | ---------------------------- |
| `X-Debug-Token`      | The request token (UUID v4)  |
| `X-Debug-Token-Link` | Link to `/_profiler/{token}` |

## List filters

Each list (HTTP, GraphQL, Commands…) has its own filter bar and is filtered
independently, so query parameters are **namespaced by the section key**:
`<section>_<filter>`. The HTTP list, for example, uses `http_method`, `http_status`…

```
GET /_profiler?http_method=GET&http_minDuration=100&http_q=/api&http_statusClass=2
```

The **universal** filters (available on every list) are:

| Parameter     | Description                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`           | Search across URL, GraphQL operation name and command name                                                                                                              |
| `status`      | Exact response status code                                                                                                                                              |
| `statusClass` | Status class: `2`, `3`, `4` or `5` (matches 2xx…5xx)                                                                                                                    |
| `minDuration` | Minimum duration in ms                                                                                                                                                  |
| `maxDuration` | Maximum duration in ms                                                                                                                                                  |
| `tag`         | Keep only profiles carrying a performance tag (`slow`, `n-plus-one`, `chatty`, `large-payload`) — see [Performance tags](/docs/packages/nest-profiler/performance-tags) |
| `exception`   | Keep only profiles whose captured failure is of this type — an exception class (`NotFoundException`) or, for GraphQL, an error code (`BAD_USER_INPUT`)                  |
| `error`       | Checkbox — keep only profiles that **failed**, per each kind's [error classification](/docs/packages/nest-profiler/error-classification)                                |

`exception` and `error` answer different questions and are meant to be used
together. `error` asks _"what failed?"_ — a verdict you configure, which by
default does **not** count a `404` even though its `NotFoundException` was
captured. `exception` asks _"show me the `NotFoundException`s"_, regardless of
whether they count as failures. Its options are not a fixed list: they are the
values actually present in your store, so each list offers only what it has
really seen.

Each entrypoint kind also contributes **scoped** filters, shown only above its own
list — e.g. `method` (HTTP), `operationType` (GraphQL, via
`@eleven-labs/nest-profiler-graphql`), `commandStatus` (Commands). A scoped filter
is namespaced like any other: `graphql_operationType=mutation`.

A kind may also **hide** a universal filter that is redundant on its own list: the
Commands list has no `error` checkbox, since its `commandStatus` filter
(`Success`/`Failed`) already asks exactly that.

### Custom list filters

Filters are pluggable. A filter is a `ProfilerListFilter` — it describes its own
control, parses its raw query value and decides whether a profile matches:

```ts
import { ProfilerCoreService, ProfilerListFilter } from '@eleven-labs/nest-profiler';

const slowFilter: ProfilerListFilter<boolean> = {
  key: 'slow',
  label: 'Slow only',
  control: 'checkbox',
  // Checked boxes submit '1'; undefined keeps the filter inactive.
  parse: (raw) => (raw ? true : undefined),
  matches: (profile) => (profile.performance.duration ?? 0) >= 500,
};
```

Register it from a module's `onModuleInit` (the cross-module path, robust to
import order):

```ts
core.registerListFilter(slowFilter); // core: ProfilerCoreService
```

or declaratively via the `PROFILER_LIST_FILTERS` multi-token:

```ts
{ provide: PROFILER_LIST_FILTERS, useValue: slowFilter, multi: true }
```

## Pagination

Each list paginates independently to keep the page light when many profiles are
captured. A section shows `listPageSize` profiles per page (default **25**,
configurable via `ProfilerModule.forRoot({ listPageSize })`) with a
Previous/Next pager; the pager is hidden when a section fits on one page.

The current page is carried as a **section-namespaced** query parameter,
`<section>_page`, so sections page independently — and pager links preserve the
active filters and the other sections' pages:

```
GET /_profiler?http_page=2&graphql_page=3&http_status=200
```

Page numbers are 1-based and clamped to the available range. Submitting a filter
bar resets every section back to page 1, since the result set changed.

## Export a profile

Every profile detail page has an **Export JSON** button. You can also download the raw profile directly:

```bash
curl http://localhost:3000/_profiler/{token}/data > profile.json
```

## Copying requests & queries

Inspired by the Symfony Web Profiler, the detail page offers one-click **copy** buttons that turn a captured operation into something you can paste straight into a terminal or REPL:

| Panel                    | Button                      | What you get                                                                               |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| Request                  | Copy as cURL                | A runnable `curl` command for the incoming request (method, absolute URL, headers, body)   |
| HTTP Client              | Copy as cURL                | The same, for each outgoing request the handler made                                       |
| SQL (TypeORM / MikroORM) | Copy SQL                    | The query with its bound parameters inlined, ready to run in a SQL client                  |
| MongoDB                  | Copy query                  | A `mongosh` command — `db.<collection>.<op>(<filter>)` or `db.<collection>.aggregate([…])` |
| RabbitMQ                 | Copy payload / Copy publish | The decoded message payload, and an amqplib `channel.publish(…)` snippet that re-emits it  |

Header values that the profiler masks at capture time (e.g. `authorization`) stay masked in the copied command — the feature is for replaying requests during development, not for exfiltrating secrets.

The cURL and SQL builders are also exported for programmatic use:

```ts
import { buildCurlCommand, interpolateSql } from '@eleven-labs/nest-profiler';

buildCurlCommand({
  method: 'POST',
  url: '/users',
  headers: { host: 'localhost:3000' },
  body: { name: 'Ada' },
});
interpolateSql('SELECT * FROM "user" WHERE id = $1', [42]); // → SELECT * FROM "user" WHERE id = 42
```

> **Visual tour** — the [Profiler UI](https://nest-profiler.eleven-labs.com/docs/profiler-ui) page walks through the profiles list, every built-in tab and every collector panel with screenshots.
