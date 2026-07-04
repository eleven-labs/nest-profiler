import type { ExecutionContext } from '@nestjs/common';
import type { Profile } from '../interfaces/profile.interface';

/**
 * Contract for teaching the profiler a non-HTTP protocol (GraphQL, gRPC,
 * WebSockets, message queues…) without modifying the core.
 *
 * Implement it and register it from your module's `onModuleInit` via
 * `ProfilerCoreService.registerContextAdapter(adapter)` (resolve the core with
 * `moduleRef.get(ProfilerCoreService, { strict: false })`). `ProfilerInterceptor`
 * then routes every execution context whose type equals {@link contextType} to
 * your adapter. This imperative registration is the single supported mechanism.
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
  /**
   * Optional. Returns the underlying transport request (e.g. the HTTP request behind a
   * GraphQL operation). When the interceptor re-establishes the CLS context on a recovered
   * path, it reposes this request under `profiler.request` so request-scoped collectors
   * (notably the auth collector reading `req.user`) work for non-HTTP entrypoints too.
   */
  getRequest?(ctx: ExecutionContext): object | undefined;
}
