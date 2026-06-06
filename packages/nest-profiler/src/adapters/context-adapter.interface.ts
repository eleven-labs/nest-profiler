import type { ExecutionContext } from '@nestjs/common';
import type { Profile } from '../interfaces/profile.interface';

/**
 * DI multi-token under which {@link IContextAdapter} implementations are
 * provided. Register an adapter with `{ provide: PROFILER_CONTEXT_ADAPTERS,
 * useClass: MyAdapter, multi: true }` and the profiler picks it up at bootstrap.
 */
export const PROFILER_CONTEXT_ADAPTERS = 'PROFILER_CONTEXT_ADAPTERS';

/**
 * Contract for teaching the profiler a non-HTTP protocol (GraphQL, gRPC,
 * WebSockets, message queues…) without modifying the core.
 *
 * Implement it, expose it via the {@link PROFILER_CONTEXT_ADAPTERS} multi-token
 * (or call {@link ProfilerCoreService.registerContextAdapter}), and
 * `ProfilerInterceptor` will route every execution context whose type equals
 * {@link contextType} to your adapter.
 */
export interface IContextAdapter {
  /** The NestJS execution-context type this adapter handles, e.g. `graphql`, `rpc`, `ws`. */
  readonly contextType: string;
  /**
   * Recovers the profile the middleware created for this request. Implementations
   * typically read it back from the protocol's request object.
   *
   * @returns The profile to populate, or `null` when it cannot be recovered (the
   *   interceptor then skips profiling for this context).
   */
  recoverProfile(ctx: ExecutionContext): Profile | null;
  /**
   * Enriches the profile with protocol-specific metadata (operation name, route,
   * payload…) extracted from the execution context.
   */
  enrichProfile(profile: Profile, ctx: ExecutionContext): void;
  /**
   * Optional. Invoked for every HTTP response — implement it to enrich metadata
   * or surface protocol errors carried in the body (e.g. GraphQL errors returned
   * with a 200 status).
   */
  enrichHttpResponse?(profile: Profile, req: object, responseBody: unknown): void;
}
