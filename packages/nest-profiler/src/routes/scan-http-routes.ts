import { RequestMethod } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { DiscoveryService, MetadataScanner } from '@nestjs/core';

/**
 * One discovered HTTP handler. `path` is the raw joined path (no trailing slash, and the empty
 * string for a root handler) so a matching key built from it stays byte-identical to the legacy
 * {@link RouteCollector} behaviour; display code should fall back to `'/'` when it is empty.
 */
export interface ScannedHttpRoute {
  /** HTTP method name from `RequestMethod`, e.g. `'GET'`, `'ALL'`. */
  method: string;
  /** Raw full path, e.g. `'/users/:id'` (may be `''` for the application root). */
  path: string;
  /** Controller class name. */
  controller: string;
  /** Handler method name. */
  handler: string;
  /** Controller metatype, kept so callers can read per-handler param metadata. */
  controllerType: Type;
}

/**
 * Walks every registered controller (via {@link DiscoveryService}) and, for each request-mapped
 * method (via {@link MetadataScanner}), yields its HTTP method, full path and declaring
 * controller/handler. This is the single route-discovery pass shared by {@link RouteCollector}
 * (request → handler matching) and the HTTP route source (Routes panel).
 *
 * Must run at/after `onApplicationBootstrap` so consumer controllers are registered.
 */
export function scanHttpRoutes(
  discovery: DiscoveryService,
  metadataScanner: MetadataScanner,
): ScannedHttpRoute[] {
  const routes: ScannedHttpRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    if (!wrapper.instance || !wrapper.metatype) continue;
    const instance = wrapper.instance as Record<string, unknown>;
    const metatype = wrapper.metatype as Type;
    const prototype = Object.getPrototypeOf(instance) as object;
    const controllerPath = (
      (Reflect.getMetadata('path', metatype) as string | undefined) ?? ''
    ).replace(/^\/|\/$/g, '');

    metadataScanner.scanFromPrototype(instance, prototype, (methodName: string) => {
      const methodRef = instance[methodName];
      if (typeof methodRef !== 'function') return;

      const httpMethod = Reflect.getMetadata('method', methodRef) as RequestMethod | undefined;
      if (httpMethod === undefined) return;

      const methodPath = (Reflect.getMetadata('path', methodRef) as string | undefined) ?? '';
      // Collapse duplicate slashes across the WHOLE path — including the leading one — so a
      // method path that already starts with `/` (e.g. `@Get('/_profiler')`) yields `/_profiler`
      // rather than `//_profiler`. Then trim any trailing slash (root collapses to `''`).
      const fullPath = `/${[controllerPath, methodPath].filter(Boolean).join('/')}`
        .replace(/\/+/g, '/')
        .replace(/\/+$/, '');

      routes.push({
        method: RequestMethod[httpMethod],
        path: fullPath,
        controller: metatype.name,
        handler: methodName,
        controllerType: metatype,
      });
    });
  }

  return routes;
}
