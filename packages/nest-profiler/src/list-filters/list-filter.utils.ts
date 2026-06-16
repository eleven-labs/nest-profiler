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

/**
 * Whether a filter belongs in a given section's filter bar. Universal filters
 * (no {@link ProfilerListFilter.forType}) apply everywhere; a scoped filter
 * applies only to the section(s) named by its `forType` (a single type or a set).
 */
export function filterAppliesToSection(filter: ProfilerListFilter, sectionKey: string): boolean {
  if (!filter.forType) return true;
  return Array.isArray(filter.forType)
    ? filter.forType.includes(sectionKey)
    : filter.forType === sectionKey;
}

/**
 * Resolves a filter's `'select'` options for a section: {@link ProfilerListFilter.optionsFor}
 * (computed from the section's profiles) when present, otherwise its static
 * {@link ProfilerListFilter.options}. Returns a def whose `options` are concrete so
 * the template can render the control without knowing which source was used.
 */
export function resolveFilterForSection(
  filter: ProfilerListFilter,
  profiles: Profile[],
): ProfilerListFilter {
  if (!filter.optionsFor) return filter;
  return { ...filter, options: filter.optionsFor(profiles) };
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
