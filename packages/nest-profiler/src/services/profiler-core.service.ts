import { Injectable } from '@nestjs/common';
import { ProfilerStorageService } from './profiler-storage.service';
import { CollectorRegistry } from '../collectors/collector-registry.service';
import { RouteCollector } from '../collectors/route.collector';
import type { IContextAdapter } from '../adapters/context-adapter.interface';
import type { Profile } from '../interfaces/profile.interface';

/** Bundles the three core profiler services consumed by the controller and interceptor. */
@Injectable()
export class ProfilerCoreService {
  private readonly contextAdapters: IContextAdapter[] = [];

  constructor(
    readonly storage: ProfilerStorageService,
    readonly collectorRegistry: CollectorRegistry,
    readonly routeCollector: RouteCollector,
  ) {}

  /**
   * Registers a {@link IContextAdapter} so the profiler can handle a non-HTTP
   * protocol (GraphQL, gRPC, WebSockets…). Once registered, `ProfilerInterceptor`
   * delegates any execution context whose type matches the adapter's
   * {@link IContextAdapter.contextType} to it.
   *
   * Registration is idempotent per `contextType`: a second adapter declaring an
   * already-registered type is ignored, so calling this from a module's
   * `onModuleInit` is safe across re-initialization. Most consumers never call
   * it directly — the dedicated protocol packages (e.g.
   * `@eleven-labs/nest-profiler-graphql`) register their adapter for you.
   *
   * @param adapter - The context adapter to register.
   */
  registerContextAdapter(adapter: IContextAdapter): void {
    if (!this.contextAdapters.some((a) => a.contextType === adapter.contextType)) {
      this.contextAdapters.push(adapter);
    }
  }

  /**
   * Returns the adapter registered for the given context type, or `undefined`
   * when none handles it.
   *
   * @param contextType - The execution context type to look up (e.g. `graphql`).
   */
  findContextAdapter(contextType: string): IContextAdapter | undefined {
    return this.contextAdapters.find((a) => a.contextType === contextType);
  }

  /**
   * Invokes {@link IContextAdapter.enrichHttpResponse} on every registered
   * adapter that implements it, letting adapters surface protocol-specific data
   * carried in an HTTP response body (e.g. GraphQL errors returned with status
   * 200).
   *
   * @param profile - The active profile to enrich.
   * @param req - The underlying HTTP request object.
   * @param responseBody - The response body about to be sent.
   */
  enrichHttpResponse(profile: Profile, req: object, responseBody: unknown): void {
    for (const adapter of this.contextAdapters) {
      adapter.enrichHttpResponse?.(profile, req, responseBody);
    }
  }
}
