/**
 * Types backing the **Routes** global panel — a Symfony-Web-Profiler-style view of the
 * application's routing table. The core ships the built-in HTTP source; protocol packages
 * (`@eleven-labs/nest-profiler-graphql`, `-rabbitmq`, `-commander`) contribute their own
 * {@link ProfilerRouteSource} by calling {@link ProfilerCoreService.registerRouteSource} from
 * their module lifecycle hook — mirroring how entrypoint types are registered, since a DI
 * multi-token does not aggregate across dynamic module boundaries.
 */

/** A single decorated DTO property surfaced under a route's body. */
export interface RouteDtoProperty {
  /** Property name. */
  name: string;
  /** TypeScript type name from `design:type` (e.g. `'String'`, `'Number'`, `'AddressDto'`), or `'unknown'`. */
  tsType: string;
  /** class-validator rule names applied to the property (e.g. `['isEmail', 'minLength']`), when available. */
  rules?: string[];
  /** `true` when the property is marked `@IsOptional()`. */
  optional?: boolean;
}

/** The DTO class bound to a handler's `@Body()` (top-level properties only). */
export interface RouteDtoInfo {
  /** DTO class name. */
  name: string;
  /** Decorated top-level properties; empty when the class exposes no discoverable metadata. */
  properties: RouteDtoProperty[];
}

/** The introspected inputs of a single route handler. */
export interface RouteInputs {
  /** Path parameter names (e.g. `['id']` for `/users/:id`). */
  params?: string[];
  /** Query parameter names from `@Query('name')` / a `@Query()` DTO. */
  query?: string[];
  /** Request header names from `@Headers('name')`. */
  headers?: string[];
  /** Body DTO from `@Body()`, when a class type is resolvable. */
  body?: RouteDtoInfo;
}

/** A single discovered route/handler within a source's {@link RouteGroup}. */
export interface RouteEntry {
  /** Primary verb: HTTP method (`'GET'`), GraphQL operation (`'query'`), or transport pattern kind. */
  method: string;
  /** Primary locator: URL path, GraphQL field, or message pattern. */
  path: string;
  /** Declaring class name (controller / resolver / message handler). */
  controller: string;
  /** Handler method name. */
  handler: string;
  /** Introspected handler inputs, when any were discovered. */
  inputs?: RouteInputs;
}

/** One group of routes contributed by a single source (transport). */
export interface RouteGroup {
  /** Stable source discriminator, e.g. `'http'`, `'graphql'`, `'rabbitmq'`, `'command'`. */
  source: string;
  /** Human label, e.g. `'REST'`, `'GraphQL'`. */
  label: string;
  /** Inline SVG markup for the group icon. */
  icon?: string;
  /** The discovered routes for this source. */
  routes: RouteEntry[];
}

/**
 * A pluggable provider of routes for the {@link RoutesCollector} panel. Implementations discover
 * their routes (typically once, at `onApplicationBootstrap`) and return them from {@link collect},
 * which the panel calls when the profiler home page is rendered.
 */
export interface ProfilerRouteSource {
  /** Stable discriminator, matching the {@link RouteGroup.source} it emits. */
  readonly type: string;
  /** Produces the route group(s) for this source. */
  collect(): RouteGroup | RouteGroup[];
}
