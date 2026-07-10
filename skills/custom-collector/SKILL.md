---
name: custom-collector
description: |
  Write a custom @eleven-labs/nest-profiler collector, or a context adapter for a non-HTTP protocol, when no official @eleven-labs/nest-profiler-* package instruments the integration.
  Use when a user wants a profiler panel for a library/subsystem that has no ready-made collector, or wants to profile a transport (gRPC, WebSockets, a custom queue) the profiler doesn't know yet.
---

# Write a custom collector or context adapter

When an integration has no `@eleven-labs/nest-profiler-*` package, don't invent one — implement the public contract in the consumer's app. Two distinct extension points:

- **Collector** — adds a **panel** with data you gather during a request (a third-party client, a domain metric). Implement `IProfilerCollector`.
- **Context adapter** — teaches the profiler a **non-HTTP protocol** (gRPC, WebSockets, a custom message queue) so executions of that kind get profiled. Implement `IContextAdapter`.

First confirm the core profiler is set up (`setup-nest-profiler` otherwise). Then pick the right extension point above from what the user is instrumenting.

## Collector (`IProfilerCollector`)

Decorate a provider with `@ProfilerCollector()` and implement `collect(profile)`. Key fields: `name`, `label`, `icon`, `scope` (`'profile'` default, or `'global'` for once-per-list-page data like config), and optional `getBadgeValue` / `getTemplatePath`. Append entries with `appendCollectorEntry(profile, name, entry)` and read them back with `getCollectorEntries`. For query-style collectors, extend `AbstractQueryCollector` / `AbstractSqlQueryCollector`; for a home-page schema panel, `AbstractSchemaCollector`. To feed the performance-tagging engine, implement `TaggableCollector` (see the `interpret-performance-tags` skill).

```ts
import { Injectable } from '@nestjs/common';
import {
  ProfilerCollector,
  appendCollectorEntry,
  getCollectorEntries,
  type IProfilerCollector,
  type Profile,
} from '@eleven-labs/nest-profiler';

@Injectable()
@ProfilerCollector()
export class WidgetCollector implements IProfilerCollector {
  readonly name = 'widget';
  readonly label = 'Widget';
  collect(profile: Profile) {
    return getCollectorEntries(profile, this.name);
  }
  record(profile: Profile, entry: unknown) {
    appendCollectorEntry(profile, this.name, entry);
  }
}
```

Provide the collector in a module gated the same way as the core, and register a template if you add a custom panel view.

## Context adapter (`IContextAdapter`)

Implement `contextType` (e.g. `'rpc'`, `'ws'`), `recoverProfile(ctx)` (read back the profile the middleware created), and `enrichProfile(profile, ctx)` (attach protocol metadata). Optionally `enrichHttpResponse` / `getRequest`. Register it imperatively from your module's `onModuleInit`:

```ts
const core = this.moduleRef.get(ProfilerCoreService, { strict: false });
core.registerContextAdapter(new MyRpcContextAdapter());
```

Resolve `ProfilerCoreService` with `{ strict: false }` because the core is a dynamic/global module — this imperative registration is the single supported mechanism.

## Verify

Exercise the instrumented path, open a fresh profile at `/_profiler`, and confirm the new panel (collector) or the newly-profiled execution (context adapter) appears with the expected data. Confirm the app still boots with profiling disabled.

Docs: <https://nest-profiler.eleven-labs.com/docs/tutorials/custom-collector> · context adapters: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/context-adapters>
