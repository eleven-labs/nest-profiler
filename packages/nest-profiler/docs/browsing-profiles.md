Every profiled execution receives a unique token and lands in the profiler UI. This page is the **reference** for the endpoints that expose the collected data, the debug headers that link a response to its profile, the list filters, and how to export a profile.

![Profiler UI — profiles list with filters, HTTP statuses, durations and global panels](../../../docs/public/screenshots/profiler/profiles-list.png)

## Profiler UI endpoints

| Endpoint                     | Description                           |
| ---------------------------- | ------------------------------------- |
| `GET /_profiler`             | Home page — Summary + profiles (HTML) |
| `GET /_profiler/:token`      | Profile detail page (HTML)            |
| `GET /_profiler/:token/data` | Raw profile data (JSON)               |

## Home page navigation

The home page uses the same two-column layout as the detail page: a sticky left sidebar lists the available **views**, and the active one is selected server-side from a `?view=` query parameter (plain links, no client-side routing — consistent with the profiler's `script-src 'self'` CSP).

| View                       | `?view=`                | Content                                                                 |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| **Summary** (default)      | `summary`               | Aggregated overview of the recent window (see below)                    |
| **Profiling**              | `profiling`             | The per-entrypoint list sections (HTTP, GraphQL, Commands…) and filters |
| Config / Routes / Schemas… | the global panel's name | One entry per installed global-scope collector, rendered on demand      |

The `?view=` parameter coexists with the list filters, so a filtered Profiling link keeps its view: `GET /_profiler?view=profiling&http_method=POST`.

## Summary view

The default **Summary** view aggregates the most recent captured profiles into an at-a-glance dashboard, computed on demand from a single bounded query over the lightweight summary index (never a full-store scan) and cached in memory for ~30s. It reports:

- total sampled requests, the median (p50) latency with p95 / p99 alongside (the mean is relegated to a subtitle — it is skewed by outliers), and the error rate + count (a 5xx response or a captured exception);
- a **process-heap** trend chart: min / max / current with a leak / growing / stable indicator and a sparkline (moved here from the Profiling list — it is a process-level overview signal);
- a **throughput / latency time-series** — the window bucketed over time, bar height is throughput and colour is p95 latency;
- request distributions by HTTP method, by status class (2xx/3xx/4xx/5xx) and by **entrypoint kind** (http, graphql, command, rabbitmq…);
- a **performance-issues** breakdown: for each tag (slow, N+1, chatty…), the endpoints that trigger it — with the entrypoint kind on each row (HTTP method, CLI, RMQ, GQL);
- the slowest endpoints and the most recent errors — entrypoint-agnostic: HTTP groups by matched route (falling back to `method` + URL), while a command, a consumed message or a GraphQL operation shows its own label.

Metric cards and rows link through to the **Profiling** view's filters, so a distribution bar or a slow endpoint opens the matching filtered list. Each table shows a bounded **top N** (labelled "Top 5 …") with a **View all →** link into the full, paginated Profiling list. The window size, cache TTL and per-table row count are configurable via the `summary` module option (`windowSize` / `cacheTtl` / `topN`, default 5 — e.g. set `topN: 10` to show ten rows), and the whole summary is available as JSON at `GET /_profiler/summary.json`.

#### What counts as an error

The Summary's **error rate**, its **recent-errors** table and the timeline's error bars use a single, configurable notion of failure. By default a profile is a failure when it returns a **5xx** status or captured an **unhandled exception** — so 4xx like `401`/`404` are deliberately _not_ counted. Tune it with `summary.error`:

```ts
ProfilerModule.forRoot({
  summary: {
    error: {
      // Which HTTP codes count. A number is a lower bound; a predicate gives full control.
      httpStatus: (code) => code >= 500 || code === 429, // default: code >= 500
      exceptions: true, // count captured exceptions (default)
      // Qualify kinds without a status code (commands, GraphQL, RabbitMQ) from their own index
      // attributes/tags. Return true/false to decide, or undefined to defer to the rules above.
      classify: (info) =>
        info.type === 'command' ? info.attributes.commandExitCode !== 0 : undefined,
    },
  },
});
```

This governs only the Summary's notion of an error. The Profiling list's `error` **tag/filter** is a separate, rule-engine concern (it flags any entry with a status ≥ 400 or a captured error) — see [Performance tags](/docs/packages/nest-profiler/performance-tags).

### Extending the Summary from a collector

Any collector — built-in, from a package, or a **custom** one you register with `@ProfilerCollector` — can add its own tile or table to the Summary by implementing `buildSummary(profiles, context?)`. It receives the bounded window of profiles (and a `context` carrying the shared `topN` row cap a contributed table should honour), reads its own entries, and returns a `CollectorSummarySection` with metric **tiles** and/or a custom **table/block** rendered from an EJS `templatePath` (the same mechanism as the detail-page panels). Contributions are isolated (a throw is skipped) and only built when at least one collector opts in.

```ts
import type {
  IProfilerCollector,
  Profile,
  CollectorSummarySection,
} from '@eleven-labs/nest-profiler';

@ProfilerCollector({ name: 'mailer', label: 'Mailer' })
export class MailerCollector implements IProfilerCollector {
  readonly name = 'mailer';
  collect(profile: Profile) {
    /* … */
  }

  buildSummary(profiles: Profile[]): CollectorSummarySection | undefined {
    const sent = profiles.reduce(
      (n, p) => n + ((p.collectors.mailer as unknown[])?.length ?? 0),
      0,
    );
    if (sent === 0) return undefined;
    return {
      name: 'mailer',
      label: 'Mailer',
      tiles: [
        {
          label: 'Emails sent',
          value: String(sent),
          hint: `${(sent / profiles.length).toFixed(1)} / request`,
        },
      ],
      // Optional custom table: templatePath: '/abs/path/to/mailer-summary.ejs', data: { … }
    };
  }
}
```

The built-in query collectors (TypeORM / MikroORM / Mongoose) contribute a **Database** section (query count, average query time, a slow-query count over the threshold, and a slowest-queries table — SQL text for the ORMs, the mongo command for Mongoose; each row links to the profile that ran it, on the collector's tab), and `@eleven-labs/nest-profiler-cache` contributes a **Cache** section (hit rate, hits, misses).

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
GET /_profiler?view=profiling&http_method=GET&http_minDuration=100&http_q=/api&http_statusClass=2
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
| `error`       | Checkbox — keep only profiles with a failed call or unhandled exception (the `error` tag)                                                                               |

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
