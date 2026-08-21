/**
 * Types backing the **Discover** global panels — a Symfony-Web-Profiler-style view of the
 * application's routing table, one sidebar view per transport. The core ships the built-in
 * HTTP source; protocol packages
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

/** A single documented input of a non-HTTP route — a CLI option, a GraphQL argument, … */
export interface RouteInputItem {
  /** Display name, e.g. `-l, --limit <limit>` for a CLI option or `id` for a GraphQL argument. */
  name: string;
  /** Human description, when the source declares one (e.g. `@Option({ description })`). */
  description?: string;
  /** `true` when the input is mandatory. */
  required?: boolean;
  /** Default value, pre-formatted for display. */
  defaultValue?: string;
}

/**
 * A labelled set of inputs for a source whose inputs are not HTTP-shaped — the CLI source emits
 * `Arguments` and `Options`, GraphQL emits `Arguments`. Rendered as its own titled section, so a
 * source never has to borrow an HTTP label (`query`) for something that is not a query param.
 */
export interface RouteInputGroup {
  /** Section title, e.g. `Arguments`, `Options`. */
  label: string;
  /** The inputs in this group; an empty group is not rendered. */
  items: RouteInputItem[];
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
  /** Source-specific labelled input groups, rendered after the HTTP sections. */
  groups?: RouteInputGroup[];
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
  /** Human description of the route, when the source declares one (e.g. `@Command({ description })`). */
  description?: string;
  /** Introspected handler inputs, when any were discovered. */
  inputs?: RouteInputs;
  /**
   * Guard class names protecting the route (from `@UseGuards()` on the controller and/or the
   * handler) — e.g. an authentication guard. Absent/empty means no route-level guard was found;
   * note a global `APP_GUARD` is not attached per handler, so it is not reflected here.
   */
  guards?: string[];
}

/** One group of routes contributed by a single source (transport), rendered as its own **Discover** view. */
export interface RouteGroup {
  /** Stable source discriminator, e.g. `'http'`, `'graphql'`, `'rabbitmq'`, `'command'`. */
  source: string;
  /**
   * Human label, e.g. `'HTTP'`, `'GraphQL'`. Use the protocol's own name — the same one its list
   * section under **Profiling** carries — so a protocol is named once, not twice.
   */
  label: string;
  /** Inline SVG markup for the group icon. */
  icon?: string;
  /**
   * Singular noun naming what the group's entries are, used in its count line — `'command'`
   * for a CLI, `'field'` for GraphQL. Defaults to `'route'`, so a source whose entries really
   * are routes needs nothing; anything else avoids calling a command a route.
   */
  itemLabel?: string;
  /** The discovered routes for this source. */
  routes: RouteEntry[];
}

/**
 * A pluggable provider of routes for the **Discover** panels. Implementations discover their
 * routes (typically once, at `onApplicationBootstrap`) and return them from {@link collect},
 * which the panel calls when the profiler home page is rendered. Each returned group becomes
 * one sidebar view of its own.
 */
export interface ProfilerRouteSource {
  /** Stable discriminator, matching the {@link RouteGroup.source} it emits. */
  readonly type: string;
  /** Produces the route group(s) for this source. */
  collect(): RouteGroup | RouteGroup[];
}
