Collectors are the units that turn an execution into panels: each active collector contributes one tab to the profile detail view. On top of them, every timed operation of a request is merged into one **trace** shown in the built-in **Performance** tab. Any provider can become a collector with the `@ProfilerCollector()` decorator — this page covers both.

## Trace spans

Inject `TracerService` and wrap any piece of work in `span()`:

```ts
import { TracerService } from '@eleven-labs/nest-profiler';

@Injectable()
export class UserService {
  constructor(private readonly tracer: TracerService) {}

  async findAll() {
    return this.tracer.span('db.findAll', async (span) => {
      const users = await this.userRepository.find();
      span.setTag('count', users.length);
      return users;
    });
  }
}
```

The span is closed however the callback ends — returned value, thrown error, rejected promise — and an error marks it red on the waterfall before being re-thrown, so a failing branch is visible instead of simply missing. The callback's value is returned unchanged, so wrapping a method never changes what it returns.

### Measuring a whole method: `@Span()`

When what you want to time _is_ the method, the decorator is the shorter and safer form:

```ts
import { Span } from '@eleven-labs/nest-profiler';

@Injectable()
export class ProductService {
  @Span('db.products.findAll')
  async findAll(): Promise<Product[]> {
    return this.repo.findAll();
  }
}
```

It gives the same span as `span()` — same nesting, same error marking — for one line, and with two properties a callback cannot have: the body keeps its own indentation, and `return` still returns from the method. Wrapped in a callback, an early `return` exits the callback, which is a genuine footgun in a long method.

The name defaults to `ClassName.methodName`, which is right often enough that naming it is the exception. It needs no injection either: like `createProfilerLogger`, it resolves the active profile from the CLS store, so it works on a provider that has never heard of `TracerService`.

Use `span()` when you need to time a block _within_ a method, or to tag the span from the work itself — the callback is what gives you the handle.

### Nesting is exact, not guessed

While the callback runs, its span is the **active** one: every query, outgoing call, log line and nested `span()` issued underneath records it as its parent. The waterfall is therefore a real tree, not bars sorted by start time.

```ts
await this.tracer.span('checkout', async () => {
  await this.tracer.span('checkout.pricing', () => this.pricing.quote(cart));
  await this.tracer.span('checkout.payment', () => this.payments.charge(cart));
});
```

This matters most where a clock cannot help. Two calls fired together with `Promise.all` enclose one another in time purely by accident; nothing about their timing says whether one caused the other. The async context does, so concurrent spans stay siblings.

### The span handle

The callback receives a `TraceSpanDelegate`:

| Method               | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `setTag(key, value)` | attach one display value (`rowCount`, `statusCode`, a domain id) |
| `addTags(tags)`      | attach several at once                                           |
| `markFailed()`       | mark the span red without ending it                              |
| `end()`              | close it — only needed with `startSpan()`                        |

`activeSpan()` returns the same handle from code that did not open the span, so a helper deep in a call stack can annotate the work it is inside.

### When start and end are not in the same function

`startSpan(name)` returns the handle instead of running a callback, for work whose two ends you control separately (an event-handler pair, a stream opened here and consumed there):

```ts
const span = this.tracer.startSpan('stream.export');
try {
  await pipeline(source, destination);
} finally {
  span.end();
}
```

It does **not** become the active span. Making a span active means holding an async scope open, and there is no scope to hold when the caller owns both ends — so work started afterwards is recorded as this span's _sibling_, not its child. Prefer `span()` whenever the shape allows it. `end()` is idempotent, so calling it twice is harmless.

### Errors your code handled

The profiler's exceptions come from the global filter, which sees only what propagates out of the handler. An error you caught yourself — a fallback to cache, a retry that eventually succeeded, a deliberate degradation — is invisible unless you report it:

```ts
try {
  await this.billing.sync(accountId);
} catch (error) {
  this.tracer.captureError(error, { accountId, retryable: true });
  return this.fallback(accountId);
}
```

The entry is marked `handled`, so it appears in the Exceptions tab and reddens the span **without** counting the profile as failed — a request that recovered and answered 200 did not fail.

### Custom facets

`setAttribute()` writes into the profile's indexed attributes, so a value written from application code becomes filterable from the profiles list — "show me the slow requests of this tenant" is then a question the list can answer:

```ts
this.tracer.setAttribute('tenant', tenant.id);
const current = this.tracer.getAttribute('tenant');
```

### Nothing throws outside a profiled request

Every method above is a no-op when there is no active profile — during bootstrap, in a background task, or simply because the profiler is disabled, which is how it should be deployed in production. `span()` still runs its callback and returns its value; the others return `undefined` or do nothing. A method annotated with a span behaves identically whether the debugging tool is plugged in or not, which is the point: this is deliberately unlike an APM agent, which is expected to run everywhere and throws when it cannot.

### What else lands on the trace

You rarely need many spans of your own, because the bundled collectors put their work on the same
axis for free. Out of the box the trace already carries:

| Kind             | Contributed by                                                              |
| ---------------- | --------------------------------------------------------------------------- |
| the entrypoint   | the request, command or consumed message being profiled                     |
| framework phases | guards, validation and the controller, drawn in the flat band above         |
| database         | TypeORM, MikroORM and Mongoose — one bar per statement                      |
| HTTP             | every outgoing call captured by `nest-profiler-http` (axios, fetch, custom) |
| cache            | every cache-manager operation                                               |

Each of those bars carries the performance tags the rule engine gave it (`slow`, `n-plus-one`) and
links back to the row in its own panel that holds the full detail — the statement and its plan, the
response body. So a span of your own is worth adding when it names a **unit of work** the framework
cannot see: `checkout`, `reviews.load`, `report.render`. The queries and calls it issues nest under
it on their own.

### Contributing spans from your own collector

A collector puts its entries on the trace by implementing `TraceContributor` — one method, and no
change to its capture path:

```ts
import { entriesToSpans, ProfilerCollector } from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, RawSpan, TraceContributor } from '@eleven-labs/nest-profiler';

@ProfilerCollector({ name: 'grpc' })
export class GrpcCollector implements IProfilerCollector, TraceContributor {
  readonly name = 'grpc';

  collect(profile: Profile) {
    /* … */
  }

  getTraceSpans(profile: Profile): RawSpan[] {
    return entriesToSpans(profile.collectors[this.name] as GrpcEntry[] | undefined, {
      kind: 'custom',
      collector: this.name,
      label: (entry) => `${entry.service}/${entry.method}`,
      meta: (entry) => ({ code: entry.statusCode }),
    });
  }
}
```

Nothing is re-timed: `entriesToSpans` reads the `startedAt` and `duration` your instrumentation
already recorded, plus the parent span stamped when the entry was captured. That stamping is
automatic — `appendCollectorEntry()` is the funnel every instrumentation goes through, and it reads
the active span from the async context — so a custom collector inherits correct nesting without
knowing the trace exists. An entry with no `startedAt` is skipped rather than drawn at the origin.

`getTraceSpans` runs **after** the rule engine, so `entry.tags` is already populated and the bars
carry their tags. A contributor that throws is isolated and logged: one bad source cannot drop the
whole trace.

### How durations are measured

Elapsed time — the request duration and every span — is measured on a **monotonic** clock, and the recorded value is a fractional number of milliseconds with up to three decimals. Two consequences worth knowing:

- **Sub-millisecond work is visible.** A span that takes 420 µs reads `0.42ms`, not `0ms`, so the timeline stays comparable for ordinary application phases and not just for slow I/O.
- **A duration can never be wrong or negative.** The wall clock is not monotonic: an NTP correction or a manual clock change during a request would otherwise produce a nonsensical duration, and a backward step a negative one — which would then flow into the `slow` tag, the duration list filter and the stored profile.

Absolute timestamps stay on the epoch, because they are what a reader needs: `performance.startTime`, a span's `startedAt`, and every log and exception timestamp are epoch milliseconds, rendered in the [configured timezone](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#timezone-of-displayed-timestamps). Span timestamps carry sub-millisecond precision, which is what lets two short spans be drawn apart rather than on the same pixel.

If you render a duration yourself — in a custom collector panel — use the `formatDuration` template helper rather than printing the raw number, which carries float noise (`1.6000000000058208`). It trades precision against magnitude: two decimals below 10 ms, one below 100 ms, whole milliseconds above, and `<0.01` for anything too small to show.

A profile kind contributed by a package gets this for free as long as it marks its own start with `markProfileStart(profile)` when it builds the profile (the bundled `commander` and `rabbitmq` kinds do). A custom kind that does not falls back to the wall-clock difference against `performance.startTime` — clamped at zero, so still never negative.

![Performance tab with the duration, CPU time, heap delta, event-loop utilization and the execution trace of the recorded spans](../../../docs/public/screenshots/profiler/performance.png)

## Reading the active profile

Anything running inside a profiled execution — a custom collector, a patched client, your own code — reaches the active profile through the CLS store. Read it with the exported accessors rather than the store directly:

```ts
import {
  readProfile,
  readToken,
  readTraceId,
  readRequest,
  readActiveSpanId,
} from '@eleven-labs/nest-profiler';

const profile = readProfile(cls); // the Profile being collected into
const token = readToken(cls); // its debug token
const traceId = readTraceId(cls); // its correlation id
const request = readRequest(cls); // the transport request (Express / Fastify)
const spanId = readActiveSpanId(cls); // the span currently open, if any
```

Each returns `undefined` when nothing is being profiled — outside a request, during bootstrap, in a background job, or with the profiler disabled. That is an answer, not an error, so there is no `try`/`catch` to write: reading the store directly throws outside an active context. `cls` may itself be `undefined` (what `tryResolve` gives a collector when the core is disabled) and the accessors handle that too.

A package driving its own entrypoint kind publishes the context with `setProfileContext(cls, profile, request?)` from inside its `cls.run()` callback; it derives the token from the profile, so the two cannot disagree.

## Custom collectors

Annotate a provider with `@ProfilerCollector()` to automatically add a custom data panel to every profile. The collector is auto-discovered via NestJS `DiscoveryModule` — no manual registration required.

```ts
import { Injectable } from '@nestjs/common';
import { ProfilerCollector, IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import * as path from 'path';

const MY_ICON = `<svg viewBox="0 0 16 16" fill="currentColor">...</svg>`;

@Injectable()
@ProfilerCollector({
  name: 'myCollector',
  label: 'My Collector',
  icon: MY_ICON,
  priority: 50,
})
export class MyCollector implements IProfilerCollector {
  readonly name = 'myCollector';
  readonly label = 'My Collector';
  readonly icon = MY_ICON;
  readonly priority = 50;

  getBadgeValue(profile: Profile): string | null {
    // Return a value to display as a badge in the toolbar
    return '42';
  }

  getTemplatePath(): string {
    // Optional: path to a custom EJS panel template
    return path.join(__dirname, 'templates', 'my-collector-panel.ejs');
  }

  collect(profile: Profile): unknown {
    // Return any serializable data for this panel
    return { items: [] };
  }
}
```

Register the collector as a provider in your module — the profiler discovers it automatically at startup.

## Global-scope collectors

A collector describing the **application** rather than one execution declares `scope: 'global'`. It runs once per home-page render and becomes a sidebar view instead of a profile tab — that is how the Runtime, Config, Schemas and Discover views are built. Its count badge is read from the first `*Count` field its data exposes (`entityCount`, `routeCount`…).

Declaring `group` / `groupLabel` files the view under a sidebar heading, so several related views read as one family (`Schemas / TypeORM`, `Schemas / Mongoose`). Ungrouped views stay flat at the end of the sidebar.

A global collector whose snapshot really holds several independent subjects can split it with `expandGlobalPanels()` — one view per subject instead of one panel aggregating them. It receives the value `collect()` returned:

```ts
@Injectable()
@ProfilerCollector({
  name: 'queues',
  scope: 'global',
  group: 'queues',
  groupLabel: 'Queues',
  priority: 75,
})
export class QueuesCollector implements IProfilerCollector {
  readonly name = 'queues';

  collect(): unknown {
    return { queues: [{ name: 'emails', jobs: 12 }] };
  }

  expandGlobalPanels(data: unknown): GlobalPanelDescriptor[] {
    return (data as { queues: { name: string; jobs: number }[] }).queues.map((queue) => ({
      name: `queues-${queue.name}`, // the `?view=` key — keep it unique across every view
      label: queue.name,
      data: queue,
      badge: queue.jobs,
    }));
  }
}
```

The group, icon, template and priority come from the collector, so each descriptor only carries what differs. Returning an empty array hides the collector from the sidebar entirely — an installed package with nothing to show adds no empty view. That is exactly how `@eleven-labs/nest-profiler-routes` turns its route sources into one **Discover** view per transport.

## Custom EJS panel template

When `getTemplatePath()` is defined, the profiler renders your custom EJS template instead of the default JSON dump. The template receives:

| Variable       | Type                       | Description                   |
| -------------- | -------------------------- | ----------------------------- |
| `data`         | `unknown`                  | Value returned by `collect()` |
| `profile`      | `Profile`                  | The full request profile      |
| `panel`        | `CollectorPanelInfo`       | Panel metadata (name, label…) |
| `highlightSql` | `(sql: string) => string`  | SQL syntax highlighter        |
| `toJson`       | `(val: unknown) => string` | JSON formatter                |
| `isoDate`      | `(ts: number) => string`   | ISO date formatter            |
| `timeOnly`     | `(ts: number) => string`   | Time-only formatter           |

> **Step-by-step tutorial** — [Build a custom collector](https://nest-profiler.eleven-labs.com/docs/tutorials/custom-collector) walks through writing a collector, its EJS panel and its badge from scratch.
