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

  /** Registers a context adapter for non-HTTP protocols (GraphQL, gRPC, etc.). */
  registerContextAdapter(adapter: IContextAdapter): void {
    if (!this.contextAdapters.some((a) => a.contextType === adapter.contextType)) {
      this.contextAdapters.push(adapter);
    }
  }

  /** Returns the registered adapter for the given context type, or undefined. */
  findContextAdapter(contextType: string): IContextAdapter | undefined {
    return this.contextAdapters.find((a) => a.contextType === contextType);
  }

  /**
   * Calls `enrichHttpResponse()` on every registered adapter that implements it.
   * Invoked by ProfilerInterceptor for each HTTP response, allowing adapters to
   * populate request metadata (e.g. GraphQL operation info) and surface errors.
   */
  enrichHttpResponse(profile: Profile, req: Record<string, unknown>, responseBody: unknown): void {
    for (const adapter of this.contextAdapters) {
      adapter.enrichHttpResponse?.(profile, req, responseBody);
    }
  }
}
