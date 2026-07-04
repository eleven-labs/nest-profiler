import type { Profile } from '../interfaces/profile.interface';
import type { IndexAttributesProvider, ProfileSummary, SummaryPrimitive } from './profile-summary';
import { summarizeProfile } from './profile-summary';

/** Comparison operators a {@link FilterCriterion} may use against a summary field. */
export type FilterOp = 'eq' | 'gte' | 'lte' | 'range' | 'contains' | 'truthy';

/**
 * A single declarative filter clause: which {@link ProfileSummary} field to test,
 * how, and against what value. Filters translate their parsed value into one of
 * these (via `ProfilerListFilter.toCriterion`) so a storage adapter can push the
 * whole query down instead of running a JS predicate per profile.
 *
 * `field` names a base summary field (`statusCode`, `duration`, `method`,
 * `hasExceptions`, `search`, …) or a kind-specific facet as `attributes.<key>`.
 */
export interface FilterCriterion {
  readonly field: string;
  readonly op: FilterOp;
  /** The comparison operand. For `range`, a `[min, max]` tuple; unused by `truthy`. */
  readonly value?: unknown;
}

/**
 * A structured, adapter-agnostic list query: a section constraint (by entrypoint
 * type), AND-combined filter criteria, sort and pagination. Built by the controller
 * from the active list filters and handed to {@link IProfilerStorageAdapter.query}.
 */
export interface ProfilerQuery {
  /** Restrict to these entrypoint types (a section's own type). */
  readonly typeIn?: string[];
  /** Exclude these entrypoint types — used by the catch-all (default) section. */
  readonly typeNotIn?: string[];
  /** Filter criteria, combined with AND semantics. */
  readonly filters: FilterCriterion[];
  /** Sort key/direction. Defaults to `createdAt` descending (newest first). */
  readonly sort?: { field: 'createdAt'; direction: 'asc' | 'desc' };
  /** 1-based page number. */
  readonly page: number;
  /** Profiles per page. */
  readonly pageSize: number;
}

/** A page of profiles plus the total count of profiles matching the query. */
export interface ProfilerPage {
  readonly items: Profile[];
  readonly total: number;
}

/** Resolves a criterion field on a summary, supporting `attributes.<key>` paths. */
export function resolveField(summary: ProfileSummary, field: string): SummaryPrimitive | undefined {
  if (field.startsWith('attributes.')) return summary.attributes[field.slice('attributes.'.length)];
  return (summary as unknown as Record<string, SummaryPrimitive | undefined>)[field];
}

/** Whether a summary satisfies a single criterion (the generic in-memory evaluator). */
export function matchesCriterion(summary: ProfileSummary, criterion: FilterCriterion): boolean {
  const actual = resolveField(summary, criterion.field);
  switch (criterion.op) {
    case 'eq':
      if (typeof actual === 'string' && typeof criterion.value === 'string') {
        return actual.toLowerCase() === criterion.value.toLowerCase();
      }
      return actual === criterion.value;
    case 'gte':
      return typeof actual === 'number' && actual >= (criterion.value as number);
    case 'lte':
      return typeof actual === 'number' && actual <= (criterion.value as number);
    case 'range': {
      const [min, max] = criterion.value as [number, number];
      return typeof actual === 'number' && actual >= min && actual <= max;
    }
    case 'contains':
      // Lowercase BOTH sides so `contains` is truly case-insensitive (matching the SQLite
      // adapter). Previously only the filter value was lowercased, so a filter on an
      // upper-cased stored field like `method`/`url` silently missed.
      return (
        typeof actual === 'string' &&
        actual.toLowerCase().includes(String(criterion.value).toLowerCase())
      );
    case 'truthy':
      return Boolean(actual);
    default:
      return false;
  }
}

/** Whether a summary satisfies a query's type constraint and every filter criterion. */
export function matchesQuery(summary: ProfileSummary, query: ProfilerQuery): boolean {
  // An empty `typeIn` means "no type constraint" (matching the SQLite adapter), not "match
  // nothing" — only a non-empty allowlist restricts the type.
  if (query.typeIn && query.typeIn.length > 0 && !query.typeIn.includes(summary.type)) return false;
  if (query.typeNotIn?.includes(summary.type) === true) return false;
  return query.filters.every((criterion) => matchesCriterion(summary, criterion));
}

/**
 * Filters, sorts (by `createdAt`) and slices the requested page over pre-computed
 * summaries, each paired with an arbitrary `value` returned for the matching page
 * (a full profile for the in-memory path, a token for a store that reads the page
 * lazily). Returns the page of values plus the full match `total`.
 */
export function selectPage<T>(
  entries: { summary: ProfileSummary; value: T }[],
  query: ProfilerQuery,
): { items: T[]; total: number } {
  const direction = query.sort?.direction ?? 'desc';
  const matched = entries.filter((e) => matchesQuery(e.summary, query));
  matched.sort((a, b) => {
    const byTime =
      direction === 'desc'
        ? b.summary.createdAt - a.summary.createdAt
        : a.summary.createdAt - b.summary.createdAt;
    if (byTime !== 0) return byTime;
    // Deterministic tie-breaker on token so pagination is stable when two profiles share
    // the same millisecond timestamp (matches the SQLite `ORDER BY created_at, token`).
    return direction === 'desc'
      ? b.summary.token.localeCompare(a.summary.token)
      : a.summary.token.localeCompare(b.summary.token);
  });
  const start = Math.max(0, (query.page - 1) * query.pageSize);
  return {
    items: matched.slice(start, start + query.pageSize).map((e) => e.value),
    total: matched.length,
  };
}

/**
 * The distinct, non-empty values of a summary `field` (optionally restricted to
 * `typeIn`) — the values a dynamic `select` filter offers. Operates on summaries so
 * a store can serve it straight from its index.
 */
export function distinctFromSummaries(
  summaries: ProfileSummary[],
  field: string,
  typeIn?: string[],
): SummaryPrimitive[] {
  const values = new Set<SummaryPrimitive>();
  for (const summary of summaries) {
    if (typeIn && !typeIn.includes(summary.type)) continue;
    const value = resolveField(summary, field);
    if (value !== undefined && value !== '') values.add(value);
  }
  return [...values];
}

/**
 * The shared in-memory fallback for {@link IProfilerStorageAdapter.query}: adapters
 * that don't implement a native `query` (e.g. the in-memory adapter) route through
 * this. Summarizes, filters, sorts by `createdAt` and slices the requested page,
 * returning the matching **profiles** for the page plus the full match `total`.
 */
export function applyQueryInMemory(
  profiles: Profile[],
  query: ProfilerQuery,
  getAttributes?: IndexAttributesProvider,
): ProfilerPage {
  const entries = profiles.map((profile) => ({
    summary: summarizeProfile(profile, getAttributes),
    value: profile,
  }));
  return selectPage(entries, query);
}

/**
 * The shared in-memory fallback for {@link IProfilerStorageAdapter.distinct}:
 * returns the distinct, non-empty values of `field` across the profiles (optionally
 * restricted to `typeIn`), used to populate a filter's dynamic `select` options.
 */
export function distinctInMemory(
  profiles: Profile[],
  field: string,
  getAttributes?: IndexAttributesProvider,
  typeIn?: string[],
): SummaryPrimitive[] {
  return distinctFromSummaries(
    profiles.map((profile) => summarizeProfile(profile, getAttributes)),
    field,
    typeIn,
  );
}
