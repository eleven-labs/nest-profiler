import { Injectable, OnApplicationBootstrap, RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import type { RouteInfo } from '../interfaces/profile.interface';

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
  // registered in DiscoveryService before we scan them.
  onApplicationBootstrap(): void {
    const controllers = this.discovery.getControllers();

    for (const wrapper of controllers) {
      if (!wrapper.instance || !wrapper.metatype) continue;
      const instance = wrapper.instance as Record<string, unknown>;
      const metatype = wrapper.metatype;
      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerPath = (
        (Reflect.getMetadata('path', metatype) as string | undefined) ?? ''
      ).replace(/^\/|\/$/g, '');

      this.metadataScanner.scanFromPrototype(instance, prototype, (methodName: string) => {
        const methodRef = instance[methodName];
        if (typeof methodRef !== 'function') return;

        const httpMethod = Reflect.getMetadata('method', methodRef) as RequestMethod | undefined;
        if (httpMethod === undefined) return;

        const methodPath = (Reflect.getMetadata('path', methodRef) as string | undefined) ?? '';
        const fullPath =
          `/${[controllerPath, methodPath].filter(Boolean).join('/').replace(/\/+/g, '/')}`.replace(
            /\/+$/,
            '',
          );

        const key = `${RequestMethod[httpMethod]}:${fullPath}`;
        this.routeMap.set(key, {
          controller: metatype.name,
          handler: methodName,
          path: fullPath || '/',
          method: RequestMethod[httpMethod],
        });
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
