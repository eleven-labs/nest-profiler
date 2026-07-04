The core `ProfilerModule` profiles HTTP out of the box, but it is not limited to it. Profiling a new kind of entrypoint (gRPC, Kafka, WebSockets, a CLI command…) is a two-part story, and **neither part touches the core**:

1. **Produce** the profile — an `IContextAdapter` (or a custom bootstrap, like the commander package) creates the profile and fills its `entrypoint`.
2. **Render** it — a `ProfilerEntrypointType` contributes the list-page table, the detail tab(s), the kind-scoped filter bar and the breadcrumb summary.

## The entrypoint model

Every profile records what triggered it on a single discriminated field:

```ts
profile.entrypoint = { type: string; data: unknown };
```

The core ships the built-in `http` type for REST requests, whose `data` is an `HttpRequestData`; `@eleven-labs/nest-profiler-graphql` adds a `graphql` type (its `data` extends `HttpRequestData`, since GraphQL rides on HTTP) so operations render in their own list table and detail tab. Each additional kind owns its own `data` shape and its own `type` discriminator. Profile-scoped collectors (database, cache, HTTP client…) attach to **whatever** entrypoint is active via the CLS-stored profile, so they work unchanged across HTTP requests, commands, messages and any kind you add.

`Profile` is generic over its entrypoint payload — `Profile<TData>`, defaulting to `Profile<unknown>`. Annotate the profile with your own data shape (`Profile<GrpcInfo>`) and `profile.entrypoint.data` is typed end to end, with no `as` casts in your adapter, your `summary` or your collectors.

## 1. Producing the profile — `IContextAdapter`

Implement the interface and register it from your module's `onModuleInit` via `ProfilerCoreService.registerContextAdapter()` (resolve the core leniently with `moduleRef.get(ProfilerCoreService, { strict: false })` so it degrades gracefully when the profiler is disabled). `ProfilerInterceptor` then delegates that execution-context type to your adapter automatically. Adapters must be idempotent — the interceptor may call `enrichProfile` more than once per profile.

```ts
import { Injectable, Module, Optional } from '@nestjs/common';
import type { ExecutionContext, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProfilerCoreService, PROFILER_REQ_KEY } from '@eleven-labs/nest-profiler';
import type { IContextAdapter, Profile } from '@eleven-labs/nest-profiler';

interface GrpcInfo {
  service: string;
  method: string;
}

@Injectable()
export class GrpcContextAdapter implements IContextAdapter {
  readonly contextType = 'rpc';

  recoverProfile(ctx: ExecutionContext): Profile<GrpcInfo> | null {
    const [metadata] = ctx.getArgs();
    return ((metadata as Record<symbol, unknown>)?.[PROFILER_REQ_KEY] as Profile<GrpcInfo>) ?? null;
  }

  enrichProfile(profile: Profile<GrpcInfo>, ctx: ExecutionContext): void {
    // Set the typed payload your entrypoint type will render.
    profile.entrypoint = {
      type: 'grpc',
      data: { service: ctx.getClass().name, method: ctx.getHandler().name },
    };
  }
}

// Register the adapter with the core from onModuleInit:
@Module({ providers: [GrpcContextAdapter] })
export class GrpcProfilerModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly adapter?: GrpcContextAdapter,
  ) {}

  onModuleInit(): void {
    if (!this.adapter) return;
    try {
      this.moduleRef
        .get(ProfilerCoreService, { strict: false })
        .registerContextAdapter(this.adapter);
    } catch {
      // Profiler core not available (disabled) — no-op.
    }
  }
}
```

## 2. Rendering the profile — `registerEntrypointType`

A single call teaches the profiler how to display the new kind. Resolve `ProfilerCoreService` in your module's `onModuleInit` and register the type — it derives the list section, registers the kind's scoped list filters, and exposes the detail tab(s) and breadcrumb summary. Each list renders its own filter bar: the universal filters (search, status, duration…) plus the `listFilters` you declare here, applied only to this kind's table.

```ts
core.registerEntrypointType({
  type: 'grpc',
  label: 'gRPC',
  listSection: {
    title: 'gRPC',
    description: 'gRPC calls captured by the profiler',
    order: 40,
    itemLabel: 'call',
    templatePath: path.join(__dirname, 'templates', 'grpc-section.ejs'),
  },
  detailTabs: [
    { name: 'grpc', label: 'gRPC', templatePath: path.join(__dirname, 'templates', 'grpc.ejs') },
  ],
  // Shown only above the gRPC list and applied only to gRPC profiles.
  listFilters: [
    {
      key: 'service',
      label: 'Service',
      control: 'text',
      parse: (raw) => (raw && raw.length > 0 ? raw.toLowerCase() : undefined),
      matches: (profile: Profile<GrpcInfo>, value) =>
        profile.entrypoint.data.service.toLowerCase().includes(value),
    },
  ],
  summary: (profile: Profile<GrpcInfo>) => {
    const data = profile.entrypoint.data;
    return { badge: 'gRPC', text: `${data.service}.${data.method}` };
  },
});
```

`templatePath` is an absolute path to an EJS partial that ships with your package (bundle the `templates/` folder into `dist`). List-section partials receive `{ profiles, profilerPath }`; detail-tab partials receive `{ profile }` — both also get the shared template helpers (`methodClass`, `statusClass`, `kvTable`, `isoDate`, `toJson`, …).

For a complete, runnable walkthrough — data shape, adapter, list table, detail tab and EJS templates — see the [Build a custom entrypoint type](/docs/tutorials/build-entrypoint-type) tutorial, which profiles WebSocket messages.

## Reference implementations

- `@eleven-labs/nest-profiler-commander` — produces command profiles from a bootstrap wrapper (no context adapter) and registers a `command` entrypoint type.
- `@eleven-labs/nest-profiler-graphql` — enriches the built-in `http` entrypoint with GraphQL operation metadata.
