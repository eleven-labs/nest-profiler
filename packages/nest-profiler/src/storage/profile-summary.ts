import type { HttpRequestData, Profile } from '../interfaces/profile.interface';

/** The primitive value types a {@link ProfileSummary} field (or attribute) may hold. */
export type SummaryPrimitive = string | number | boolean;

/**
 * A flat, queryable projection of a {@link Profile} used for listing, filtering,
 * sorting and paginating — without touching the full profile document.
 *
 * Storage adapters index these fields (columns, a JSON index file, secondary
 * indexes…) so a list render can filter/paginate at the store instead of loading
 * every profile into memory. The base fields are entrypoint-agnostic; kind-specific
 * facets (a GraphQL operation type, a RabbitMQ exchange…) live in {@link attributes},
 * contributed by the matching entrypoint type.
 */
export interface ProfileSummary {
  readonly token: string;
  readonly createdAt: number;
  /** {@link ProfileEntrypoint.type} discriminator (e.g. `'http'`, `'graphql'`). */
  readonly type: string;
  /** HTTP request method, uppercased. Absent for non-HTTP kinds. */
  readonly method?: string;
  /** HTTP request URL. Absent for non-HTTP kinds. */
  readonly url?: string;
  readonly statusCode?: number;
  /** Request duration in ms; `0` when not yet measured (so min/max filters treat it as fast). */
  readonly duration: number;
  readonly hasExceptions: boolean;
  /**
   * Space-delimited performance-tag ids (e.g. `' slow n-plus-one '`) aggregated by the
   * rule engine, scanned by the `tag` list filter via a `contains` criterion. Empty
   * when the profile carries no tags. Leading/trailing spaces let `contains` match a
   * whole id without a partial-id false positive.
   */
  readonly tags: string;
  /** Pre-computed, lowercased haystack scanned by the free-text `search` filter. */
  readonly search: string;
  /** Kind-specific queryable facets contributed by the entrypoint type. */
  readonly attributes: Record<string, SummaryPrimitive>;
}

/**
 * Yields the kind-specific index attributes for a profile — the entrypoint type's
 * {@link ProfilerEntrypointType.indexAttributes}, resolved by the core service.
 */
export type IndexAttributesProvider = (profile: Profile) => Record<string, SummaryPrimitive>;

/**
 * Lowercased haystack of everything the global `search` filter scans for a profile.
 *
 * Entrypoint-agnostic by design: it flattens the string (and string-array) fields of
 * `entrypoint.data`, so a new kind's primary fields (a command name/arguments, an
 * exchange/routing key…) become searchable without touching the core. GraphQL
 * operation/field names are nested, so they are pulled in explicitly.
 */
function searchHaystack(profile: Profile): string {
  const data = profile.entrypoint.data as Record<string, unknown>;
  const terms: string[] = [];
  for (const value of Object.values(data ?? {})) {
    if (typeof value === 'string') terms.push(value);
    else if (Array.isArray(value))
      terms.push(...value.filter((v): v is string => typeof v === 'string'));
  }
  const gql = (data as Partial<HttpRequestData>)?.graphql;
  if (gql) terms.push(gql.operationName ?? '', gql.fieldName);
  return terms.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Projects a {@link Profile} into its {@link ProfileSummary}. `getAttributes` (the
 * entrypoint type's index projection) supplies the kind-specific facets; when
 * omitted, {@link ProfileSummary.attributes} is empty.
 */
export function summarizeProfile(
  profile: Profile,
  getAttributes?: IndexAttributesProvider,
): ProfileSummary {
  const http = profile.entrypoint.data as Partial<HttpRequestData>;
  return {
    token: profile.token,
    createdAt: profile.createdAt,
    type: profile.entrypoint.type,
    method: typeof http?.method === 'string' ? http.method.toUpperCase() : undefined,
    url: typeof http?.url === 'string' ? http.url : undefined,
    statusCode: profile.response?.statusCode,
    duration: profile.performance.duration ?? 0,
    hasExceptions: profile.exceptions.length > 0,
    tags: tagHaystack(profile),
    search: searchHaystack(profile),
    attributes: getAttributes ? getAttributes(profile) : {},
  };
}

/**
 * Space-delimited, space-wrapped list of the profile's performance-tag ids (e.g.
 * `' slow n-plus-one '`). The wrapping spaces let the `tag` filter match a whole id
 * with a `contains ' <id> '` criterion, so `slow` never matches `very-slow`. Empty
 * string when the profile has no tags.
 */
function tagHaystack(profile: Profile): string {
  const ids = (profile.tags ?? []).map((tag) => tag.id);
  return ids.length > 0 ? ` ${ids.join(' ')} ` : '';
}
