/**
 * Types backing the **Discover** global panels — a Symfony-Web-Profiler-style view of the
 * application's routing table, one sidebar view per transport. The core ships the built-in
 * HTTP source; protocol packages
 * (`@eleven-labs/nest-profiler-graphql`, `-rabbitmq`, `-commander`) contribute their own
 * {@link ProfilerDiscoverSource} by calling {@link ProfilerCoreService.registerDiscoverSource} from
 * their module lifecycle hook — mirroring how entrypoint types are registered, since a DI
 * multi-token does not aggregate across dynamic module boundaries.
 */

/** A single decorated DTO property surfaced under a route's body. */
export interface DiscoverDtoProperty {
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
export interface DiscoverDtoInfo {
  /** DTO class name. */
  name: string;
  /** Decorated top-level properties; empty when the class exposes no discoverable metadata. */
  properties: DiscoverDtoProperty[];
}

/** A single documented input of a non-HTTP entry — a CLI option, a GraphQL argument, … */
export interface DiscoverInputItem {
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
export interface DiscoverInputGroup {
  /** Section title, e.g. `Arguments`, `Options`. */
  label: string;
  /** The inputs in this group; an empty group is not rendered. */
  items: DiscoverInputItem[];
}

/** The introspected inputs of a single route handler. */
export interface DiscoverInputs {
  /** Path parameter names (e.g. `['id']` for `/users/:id`). */
  params?: string[];
  /** Query parameter names from `@Query('name')` / a `@Query()` DTO. */
  query?: string[];
  /** Request header names from `@Headers('name')`. */
  headers?: string[];
  /** Body DTO from `@Body()`, when a class type is resolvable. */
  body?: DiscoverDtoInfo;
  /** Source-specific labelled input groups, rendered after the HTTP sections. */
  groups?: DiscoverInputGroup[];
}

/**
 * One fact a source discovered that is **not** a route — a broker exchange, a queue, a
 * connection. Rendered as a row under its {@link DiscoverSection}: the name, an optional kind
 * badge, a one-line detail, boolean flags as chips and free-form attributes as a key/value list.
 */
export interface DiscoverSectionItem {
  /** Item name, e.g. an exchange or a queue name. */
  name: string;
  /** Short qualifier rendered as a badge, e.g. an exchange type (`topic`). */
  kind?: string;
  /** One-line summary, e.g. the bindings a queue is fed by. */
  detail?: string;
  /** Boolean traits rendered as chips, e.g. `durable`, `auto-delete`. */
  flags?: string[];
  /** Free-form attributes, e.g. `{ 'x-dead-letter-exchange': 'tts.dlx' }`. */
  attributes?: Record<string, string>;
}

/**
 * A titled block of non-route facts a source contributes to its **Discover** view, rendered
 * above its route list. It exists because a transport's routing table is not always its whole
 * static surface: the RabbitMQ source lists the exchanges and queues the application declared
 * alongside the handlers consuming them, without inventing a second sidebar view for them.
 */
export interface DiscoverSection {
  /** Section title, e.g. `Exchanges`. */
  label: string;
  /** Singular noun naming the section's items, used in its count line. Defaults to `item`. */
  itemLabel?: string;
  /** The items in this section; an empty section is not rendered. */
  items: DiscoverSectionItem[];
}

/** A single discovered route/handler/command within a source's {@link DiscoverGroup}. */
export interface DiscoverEntry {
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
  inputs?: DiscoverInputs;
  /**
   * Guard class names protecting the route (from `@UseGuards()` on the controller and/or the
   * handler) — e.g. an authentication guard. Absent/empty means no route-level guard was found;
   * note a global `APP_GUARD` is not attached per handler, so it is not reflected here.
   */
  guards?: string[];
}

/** One group of entries contributed by a single source (transport), rendered as its own **Discover** view. */
export interface DiscoverGroup {
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
  /** The discovered entries for this source — routes, handlers, commands, …. */
  entries: DiscoverEntry[];
  /**
   * Static facts this source discovered that are not routes — e.g. the RabbitMQ topology the
   * application declared. Rendered above the route list, each as its own titled section.
   */
  sections?: DiscoverSection[];
}

/**
 * A pluggable provider of entries for the **Discover** panels. Implementations discover their
 * entries (typically once, at `onApplicationBootstrap`) and return them from {@link collect},
 * which the panel calls when the profiler home page is rendered. Each returned group becomes
 * one sidebar view of its own.
 */
export interface ProfilerDiscoverSource {
  /** Stable discriminator, matching the {@link DiscoverGroup.source} it emits. */
  readonly type: string;
  /** Produces the Discover group(s) for this source. */
  collect(): DiscoverGroup | DiscoverGroup[];
}
