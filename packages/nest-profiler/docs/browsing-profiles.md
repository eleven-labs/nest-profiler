Every profiled execution receives a unique token and lands in the profiler UI. This page is the **reference** for the endpoints that expose the collected data, the debug headers that link a response to its profile, the list filters, and how to export a profile.

![Profiler UI — profiles list with filters, HTTP statuses, durations and global panels](../../../docs/public/screenshots/profiler/profiles-list.png)

## Profiler UI endpoints

| Endpoint                     | Description                    |
| ---------------------------- | ------------------------------ |
| `GET /_profiler`             | List of recent profiles (HTML) |
| `GET /_profiler/:token`      | Profile detail page (HTML)     |
| `GET /_profiler/:token/data` | Raw profile data (JSON)        |

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

| Parameter       | Description                                                |
| --------------- | ---------------------------------------------------------- |
| `q`             | Search across URL, GraphQL operation name and command name |
| `status`        | Exact response status code                                 |
| `statusClass`   | Status class: `2`, `3`, `4` or `5` (matches 2xx…5xx)       |
| `minDuration`   | Minimum duration in ms                                     |
| `maxDuration`   | Maximum duration in ms                                     |
| `hasExceptions` | When set, only profiles that captured an exception         |

Each entrypoint kind also contributes **scoped** filters, shown only above its own
list — e.g. `method` (HTTP), `operationType` (GraphQL, via
`@eleven-labs/nest-profiler-graphql`), `commandStatus` (Commands). A scoped filter
is namespaced like any other: `graphql_operationType=mutation`.

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
