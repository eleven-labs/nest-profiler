import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { ProfilerCoreService, scanHttpRoutes } from '@eleven-labs/nest-profiler';
import type { ProfilerRouteSource, RouteEntry, RouteGroup } from '@eleven-labs/nest-profiler';
import { describeHandlerParams, handlerHasRouteArgs } from './describe-handler-params';

/** Inline SVG for the REST group (a globe-ish network glyph). */
const REST_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM2.5 8a5.5 5.5 0 0111 0 5.5 5.5 0 01-11 0z" opacity="0.4"/><path d="M8 1c1.7 0 3 3.1 3 7s-1.3 7-3 7-3-3.1-3-7 1.3-7 3-7zM1.5 8h13" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;

/**
 * The built-in {@link ProfilerRouteSource} for REST controllers. It discovers every request-mapped
 * handler once at `onApplicationBootstrap` (reusing the core's {@link scanHttpRoutes}), introspects
 * each handler's inputs, caches the resulting {@link RouteGroup}, and registers itself with the
 * core so the Routes panel can render it.
 */
@Injectable()
export class HttpRouteSource implements ProfilerRouteSource, OnApplicationBootstrap {
  readonly type = 'http';
  private readonly logger = new Logger(HttpRouteSource.name);
  private group: RouteGroup = { source: 'http', label: 'REST', icon: REST_ICON, routes: [] };

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    const scanned = scanHttpRoutes(this.discovery, this.metadataScanner);

    let sawRouteArgs = false;
    const routes: RouteEntry[] = scanned.map((route) => {
      if (!sawRouteArgs) sawRouteArgs = handlerHasRouteArgs(route.controllerType, route.handler);
      return {
        method: route.method,
        path: route.path || '/',
        controller: route.controller,
        handler: route.handler,
        inputs: describeHandlerParams(route.controllerType, route.handler, route.path),
      };
    });

    routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    this.group = { source: 'http', label: 'REST', icon: REST_ICON, routes };

    // Canary (mirrors ConfigCollector): if we discovered handlers but not one exposed the route-args
    // metadata we read, the @nestjs/common internal shape likely changed — warn so it's diagnosable
    // rather than silently showing routes with no params/DTOs.
    if (routes.length > 0 && !sawRouteArgs) {
      this.logger.warn(
        'Routes panel found controllers but no @Param/@Query/@Body/@Headers metadata — the ' +
          '@nestjs/common route-args metadata shape may have changed, or no handler declares parameters.',
      );
    }

    // Register with the core. A dynamic module can't reliably inject a provider exported by another
    // dynamic module, so resolve the core from the global scope (see the entrypoint-type pattern).
    try {
      const core = this.moduleRef.get(ProfilerCoreService, { strict: false });
      core.registerRouteSource(this);
    } catch {
      // ProfilerCoreService unavailable — the profiler is not configured; nothing to register with.
    }
  }

  collect(): RouteGroup {
    return this.group;
  }
}
