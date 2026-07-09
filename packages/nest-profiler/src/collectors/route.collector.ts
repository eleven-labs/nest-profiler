import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import type { RouteInfo } from '../interfaces/profile.interface';
import { scanHttpRoutes } from '../routes/scan-http-routes';

/**
 * Compiles a route path (`/users/:id`, `/files/:id(\\d+)`) into an anchored RegExp: literal
 * regex metacharacters (`.`, `(`, `+`…) are escaped, while `:param` tokens (with an optional
 * `(constraint)`) become a single-segment matcher. Escaping is required — an unescaped `.` or a
 * param constraint would otherwise cause false positives or a `SyntaxError`.
 */
function compileRoutePattern(routePath: string): RegExp {
  const source = routePath.replace(/:[A-Za-z0-9_]+(?:\([^)]*\))?|[.*+?^${}()|[\]\\]/g, (match) =>
    match.startsWith(':') ? '[^/]+' : `\\${match}`,
  );
  return new RegExp(`^${source}$`);
}

@Injectable()
export class RouteCollector implements OnApplicationBootstrap {
  private readonly routeMap = new Map<string, RouteInfo>();
  /** Memoized compiled patterns per route key (compiled once at bootstrap, not per request). */
  private readonly patternCache = new Map<string, RegExp>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {}

  // onApplicationBootstrap is called after ALL modules are initialized,
  // ensuring that controllers from consumer modules (e.g. AppModule) are
  // registered in DiscoveryService before we scan them. The discovery walk is
  // factored into scanHttpRoutes() and shared with the Routes panel's HTTP
  // source, so there is a single pass over the controllers.
  onApplicationBootstrap(): void {
    for (const route of scanHttpRoutes(this.discovery, this.metadataScanner)) {
      // Key on the raw path (empty for the root handler) to keep matching identical.
      const key = `${route.method}:${route.path}`;
      this.routeMap.set(key, {
        controller: route.controller,
        handler: route.handler,
        path: route.path || '/',
        method: route.method,
      });
    }
  }

  match(method: string, url: string): RouteInfo | undefined {
    const pathname = url.split('?')[0] ?? url;
    const key = `${method.toUpperCase()}:${pathname}`;
    if (this.routeMap.has(key)) {
      return this.routeMap.get(key);
    }
    // Fallback: try parametric route matching (simple :param replacement)
    for (const [routeKey, info] of this.routeMap) {
      // Split only on the first colon — path segments like /:id also contain colons
      const firstColon = routeKey.indexOf(':');
      const routeMethod = routeKey.slice(0, firstColon);
      const routePath = routeKey.slice(firstColon + 1);
      if (routeMethod !== method.toUpperCase()) continue;
      let pattern = this.patternCache.get(routeKey);
      if (!pattern) {
        pattern = compileRoutePattern(routePath);
        this.patternCache.set(routeKey, pattern);
      }
      if (pattern.test(pathname)) return info;
    }
    return undefined;
  }
}
