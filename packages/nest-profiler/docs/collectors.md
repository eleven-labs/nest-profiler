Collectors are the units that turn an execution into panels: each active collector contributes one tab to the profile detail view. Custom spans are captured by the profiler itself and shown in the built-in **Performance** tab, and any provider can become a collector with the `@ProfilerCollector()` decorator — this page covers both.

## Timeline spans

Instrument any code with `startSpan()` to capture custom timing data. The spans appear as an **Execution timeline** in the profile's **Performance** tab, under the duration, CPU time, heap delta and event-loop figures of the request:

```ts
import { ProfilerService } from '@eleven-labs/nest-profiler';

@Injectable()
export class UserService {
  constructor(private readonly profiler: ProfilerService) {}

  async findAll() {
    const stop = this.profiler.startSpan('db.findAll');
    const users = await this.userRepository.find();
    stop();
    return users;
  }
}
```

Span capture is always active; the timeline renders the spans as synchronized bars plus a per-phase table. A profile that recorded no span simply shows no timeline — there is no empty panel to dismiss.

Wrap the stop call in a `finally` block so the span is recorded even when the measured work throws.

### How durations are measured

Elapsed time — the request duration and every span — is measured on a **monotonic** clock (`performance.now()`), and the recorded value is a fractional number of milliseconds with up to three decimals. Two consequences worth knowing:

- **Sub-millisecond work is visible.** A span that takes 420 µs reads `0.42ms`, not `0ms`, so the timeline stays comparable for ordinary application phases and not just for slow I/O.
- **A duration can never be wrong or negative.** The wall clock is not monotonic: an NTP correction or a manual clock change during a request would otherwise produce a nonsensical duration, and a backward step a negative one — which would then flow into the `slow` tag, the duration list filter and the stored profile.

Absolute timestamps stay on the wall clock, because they are what a reader needs: `performance.startTime`, a span's `startedAt`, and every log and exception timestamp are epoch milliseconds, rendered in the [configured timezone](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#timezone-of-displayed-timestamps).

If you render a duration yourself — in a custom collector panel — use the `formatDuration` template helper rather than printing the raw number, which carries float noise (`1.6000000000058208`). It trades precision against magnitude: two decimals below 10 ms, one below 100 ms, whole milliseconds above, and `<0.01` for anything too small to show.

A profile kind contributed by a package gets this for free as long as it marks its own start with `markProfileStart(profile)` when it builds the profile (the bundled `commander` and `rabbitmq` kinds do). A custom kind that does not falls back to the wall-clock difference against `performance.startTime` — clamped at zero, so still never negative.

![Performance tab with the duration, CPU time, heap delta, event-loop utilization and the execution timeline of the recorded spans](../../../docs/public/screenshots/profiler/performance.png)

## Reading the active profile

Anything running inside a profiled execution — a custom collector, a patched client, your own code — reaches the active profile through the CLS store. Read it with the exported accessors rather than the store directly:

```ts
import { readProfile, readToken, readRequest } from '@eleven-labs/nest-profiler';

const profile = readProfile(cls); // the Profile being collected into
const token = readToken(cls); // its debug token
const request = readRequest(cls); // the transport request (Express / Fastify)
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
