import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerListSection } from '../list-sections/profiler-list-section.interface';
import type { ProfilerListFilter } from '../list-filters/profiler-list-filter.interface';
import type { SummaryPrimitive } from '../storage/profile-summary';

/**
 * DI multi-token under which {@link ProfilerEntrypointType} implementations are
 * provided. Register a type with `{ provide: PROFILER_ENTRYPOINT_TYPES,
 * useValue: myType, multi: true }` (or call
 * {@link ProfilerCoreService.registerEntrypointType}) and the profiler renders
 * its list table, detail tab(s) and `type` filter option.
 */
export const PROFILER_ENTRYPOINT_TYPES = 'PROFILER_ENTRYPOINT_TYPES';

/**
 * A primary detail-page tab for an entrypoint kind (e.g. "Request"/"Response"
 * for HTTP, "Command" for a CLI command, "Message" for a consumed message). Its
 * body is rendered from {@link templatePath} — an absolute path to an EJS
 * partial that receives `{ profile }` plus the shared template helpers.
 */
export interface ProfilerDetailTab {
  /** Tab id used in the `?tab=` query and for de-duplication. */
  readonly name: string;
  /** Label shown in the sidebar. */
  readonly label: string;
  /** Inline SVG markup for the sidebar icon. */
  readonly icon?: string;
  /** Absolute path to the EJS partial rendering this tab's body. */
  readonly templatePath: string;
  /** Optional count badge shown next to the label; `null` means "no data". */
  badge?(profile: Profile): string | number | null;
}

/** A compact summary of an entrypoint, shown in the detail-page breadcrumb. */
export interface EntrypointSummary {
  /** Short badge, e.g. `'GET'`, `'CLI'`. */
  readonly badge: string;
  /** Optional CSS class applied to the badge. */
  readonly badgeClass?: string;
  /** Primary text, e.g. the URL or the command line. */
  readonly text: string;
}

/** The list-section fields a {@link ProfilerEntrypointType} provides; `key`, `matches` and `isDefault` are derived from the type. */
export type EntrypointListSection = Omit<ProfilerListSection, 'key' | 'matches' | 'isDefault'>;

/**
 * Everything the profiler needs to support an entrypoint kind, registered in a
 * single call via {@link ProfilerCoreService.registerEntrypointType}.
 *
 * The core ships the built-in `http` type for REST requests. Protocol packages
 * contribute their own — e.g. `@eleven-labs/nest-profiler-graphql` adds `graphql`
 * and `@eleven-labs/nest-profiler-commander` adds `command` — without touching the
 * core. The profiler matches a profile to a type via
 * `profile.entrypoint.type === type`.
 */
export interface ProfilerEntrypointType {
  /** Discriminator matching {@link ProfileEntrypoint.type}. */
  readonly type: string;
  /** Human label, e.g. `'HTTP'`, `'Command'`. */
  readonly label: string;
  /**
   * The catch-all kind. Profiles whose `entrypoint.type` matches no registered
   * type fall back to it for both the list section and the detail tabs. Exactly
   * one registered type sets this — the core's `http` type.
   */
  readonly isDefault?: boolean;
  /** The list-page table for this kind (its `matches`/`key` are derived from `type`). */
  readonly listSection: EntrypointListSection;
  /** Primary detail tabs, e.g. `[request, response]` or `[command]`. */
  readonly detailTabs: ProfilerDetailTab[];
  /**
   * Filters shown above this kind's list and applied only to it — e.g. a `method`
   * filter for HTTP, an `operationType` filter for GraphQL. The universal filters
   * (search, status, duration…) are shown above every list in addition to these.
   * Their `forType` is derived from this type.
   */
  readonly listFilters?: ProfilerListFilter[];
  /** Builds the detail-page breadcrumb summary for a profile of this kind. */
  summary(profile: Profile): EntrypointSummary;
  /**
   * Kind-specific queryable facets to index for a profile of this type, exposed as
   * `attributes.<key>` in its {@link ProfileSummary} — e.g. a GraphQL `operationType`
   * or a RabbitMQ `exchange`/`routingKey`. These back the scoped `select`/filter
   * criteria a {@link listFilters} entry targets, so a storage adapter can filter on
   * them natively. Return only primitive values.
   */
  indexAttributes?(profile: Profile): Record<string, SummaryPrimitive>;
}
