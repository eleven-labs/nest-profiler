The core `ProfilerModule` profiles HTTP out of the box, but it is not limited to it. The `IContextAdapter` interface lets you profile any non-HTTP protocol (gRPC, Kafka, WebSockets…) without modifying the core: implement the interface, register it with the `PROFILER_CONTEXT_ADAPTERS` multi-token, and `ProfilerInterceptor` will delegate that context type to your adapter automatically.

## Implementing an adapter

```ts
import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PROFILER_CONTEXT_ADAPTERS, PROFILER_REQ_KEY } from '@eleven-labs/nest-profiler';
import type { IContextAdapter, Profile } from '@eleven-labs/nest-profiler';

@Injectable()
export class GrpcContextAdapter implements IContextAdapter {
  readonly contextType = 'rpc';

  recoverProfile(ctx: ExecutionContext): Profile | null {
    const [metadata] = ctx.getArgs();
    return ((metadata as Record<symbol, unknown>)?.[PROFILER_REQ_KEY] as Profile) ?? null;
  }

  enrichProfile(profile: Profile, _ctx: ExecutionContext): void {
    // add protocol-specific data to profile.request
  }
}

// Register in a dedicated module:
@Module({
  providers: [
    GrpcContextAdapter,
    { provide: PROFILER_CONTEXT_ADAPTERS, useExisting: GrpcContextAdapter, multi: true },
  ],
})
export class GrpcProfilerModule {}
```

## Reference implementation

`@eleven-labs/nest-profiler-graphql` is the reference implementation of this pattern for GraphQL (Apollo, Mercurius, graphql-yoga) — see its [package page](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-graphql) for how a complete adapter enriches profiles with protocol-specific data and extends the list filters.
