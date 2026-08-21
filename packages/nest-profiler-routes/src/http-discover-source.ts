import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import {
  HTTP_ICON,
  PROFILER_BASE_PATH,
  ProfilerCoreService,
  scanHttpRoutes,
} from '@eleven-labs/nest-profiler';
import type {
  ProfilerDiscoverSource,
  DiscoverEntry,
  DiscoverGroup,
} from '@eleven-labs/nest-profiler';
import { describeHandlerParams, handlerHasRouteArgs } from './describe-handler-params';
import { readRouteGuards } from './route-guards';

/**
 * The built-in {@link ProfilerDiscoverSource} for REST controllers. It discovers every request-mapped
 * handler once at `onApplicationBootstrap` (reusing the core's {@link scanHttpRoutes}), introspects
 * each handler's inputs, caches the resulting {@link DiscoverGroup}, and registers itself with the
 * core so the **Discover / HTTP** view can render it.
 */
@Injectable()
export class HttpDiscoverSource implements ProfilerDiscoverSource, OnApplicationBootstrap {
  readonly type = 'http';
  private readonly logger = new Logger(HttpDiscoverSource.name);
  private group: DiscoverGroup = { source: 'http', label: 'HTTP', icon: HTTP_ICON, entries: [] };

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    // Exclude the profiler's own UI/API routes — they're internal plumbing, not application routes.
    const scanned = scanHttpRoutes(this.discovery, this.metadataScanner).filter(
      (route) => !route.path.startsWith(PROFILER_BASE_PATH),
    );

    let sawRouteArgs = false;
    const entries: DiscoverEntry[] = scanned.map((route) => {
      if (!sawRouteArgs) sawRouteArgs = handlerHasRouteArgs(route.controllerType, route.handler);
      const guards = readRouteGuards(route.controllerType, route.handler);
      return {
        method: route.method,
        path: route.path || '/',
        controller: route.controller,
        handler: route.handler,
        inputs: describeHandlerParams(route.controllerType, route.handler, route.path),
        ...(guards.length > 0 ? { guards } : {}),
      };
    });

    entries.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    this.group = { source: 'http', label: 'HTTP', icon: HTTP_ICON, entries };

    // Canary (mirrors ConfigCollector): if we discovered handlers but not one exposed the route-args
    // metadata we read, the @nestjs/common internal shape likely changed — warn so it's diagnosable
    // rather than silently showing routes with no params/DTOs.
    if (entries.length > 0 && !sawRouteArgs) {
      this.logger.warn(
        'Discover panel found controllers but no @Param/@Query/@Body/@Headers metadata — the ' +
          '@nestjs/common route-args metadata shape may have changed, or no handler declares parameters.',
      );
    }

    // Register with the core. A dynamic module can't reliably inject a provider exported by another
    // dynamic module, so resolve the core from the global scope (see the entrypoint-type pattern).
    try {
      const core = this.moduleRef.get(ProfilerCoreService, { strict: false });
      core.registerDiscoverSource(this);
    } catch {
      // ProfilerCoreService unavailable — the profiler is not configured; nothing to register with.
    }
  }

  collect(): DiscoverGroup {
    return this.group;
  }
}
