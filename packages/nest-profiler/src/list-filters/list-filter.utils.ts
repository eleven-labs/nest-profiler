import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerListFilter } from './profiler-list-filter.interface';

/**
 * Lenient integer parser shared by the numeric built-in filters: absent, empty
 * or non-numeric values yield `undefined` (an inactive filter) instead of `NaN`
 * comparisons that would silently hide every profile.
 */
export function parseLenientInt(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** A parsed, active filter value paired with the definition that produced it. */
interface ActiveFilter {
  filter: ProfilerListFilter;
  value: unknown;
}

/**
 * Parses a raw query object against the given filter definitions, keeping only
 * the filters that resolved to an active value. Also returns the raw string
 * values keyed by filter so the form can re-fill its controls after submission.
 */
export function parseFilterValues(
  filters: ProfilerListFilter[],
  query: Record<string, string | string[] | undefined>,
): { active: ActiveFilter[]; raw: Record<string, string> } {
  const active: ActiveFilter[] = [];
  const raw: Record<string, string> = {};

  for (const filter of filters) {
    const queryValue = query[filter.key];
    const rawValue = Array.isArray(queryValue) ? queryValue[0] : queryValue;
    if (typeof rawValue === 'string' && rawValue.length > 0) raw[filter.key] = rawValue;

    const value = filter.parse(rawValue);
    if (value !== undefined) active.push({ filter, value });
  }

  return { active, raw };
}

/**
 * Applies the active filters to the profiles with AND semantics: a profile is
 * kept only when it matches every active filter. With no active filters the
 * input is returned unchanged.
 */
export function applyListFilters(active: ActiveFilter[], profiles: Profile[]): Profile[] {
  if (active.length === 0) return profiles;
  return profiles.filter((profile) =>
    active.every(({ filter, value }) => filter.matches(profile, value)),
  );
}
