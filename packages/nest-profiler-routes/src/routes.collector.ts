import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProfilerCollector, ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, Profile, RouteGroup } from '@eleven-labs/nest-profiler';

const ROUTES_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 100 4 2 2 0 000-4zM4 10a2 2 0 100 4 2 2 0 000-4z" opacity="0.4"/><path d="M12 6a2 2 0 100 4 2 2 0 000-4z"/><path d="M6 4h4a2 2 0 012 2M4 6v4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;

/** Panel payload: the route groups contributed by every registered source, plus a total count. */
export interface RoutesCollectorData {
  groups: RouteGroup[];
  routeCount: number;
}

/**
 * Global-scope panel listing the application's routing table — a Symfony-Routing-style "Routing"
 * view rendered on the profiler home page. It owns no discovery logic: it aggregates the
 * {@link RouteGroup}s from every `ProfilerRouteSource` registered on the core (the built-in HTTP
 * source shipped by this package, plus any contributed by protocol packages).
 */
@ProfilerCollector({
  name: 'routes',
  label: 'Routes',
  icon: ROUTES_ICON,
  priority: 85,
  scope: 'global',
})
@Injectable()
export class RoutesCollector implements IProfilerCollector {
  readonly name = 'routes';
  readonly label = 'Routes';
  readonly icon = ROUTES_ICON;
  readonly priority = 85;
  readonly scope = 'global' as const;

  private core?: ProfilerCoreService;

  constructor(private readonly moduleRef: ModuleRef) {}

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'routes-panel.ejs');
  }

  collect(_profile: Profile): RoutesCollectorData {
    const groups: RouteGroup[] = [];
    for (const source of this.resolveCore()?.getRouteSources() ?? []) {
      try {
        const result = source.collect();
        for (const group of Array.isArray(result) ? result : [result]) {
          if (group && group.routes.length > 0) groups.push(group);
        }
      } catch {
        // A misbehaving source must not break the panel; skip it.
      }
    }
    const routeCount = groups.reduce((total, group) => total + group.routes.length, 0);
    return { groups, routeCount };
  }

  /** Lazily resolves the core from the global scope (a sibling dynamic module), memoized. */
  private resolveCore(): ProfilerCoreService | undefined {
    if (!this.core) {
      try {
        this.core = this.moduleRef.get(ProfilerCoreService, { strict: false });
      } catch {
        return undefined;
      }
    }
    return this.core;
  }
}
