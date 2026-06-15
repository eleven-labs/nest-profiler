import type { HttpRequestData, Profile } from '../interfaces/profile.interface';
import type { StorageFindOptions } from './storage-adapter.interface';

/** `method`/`url` are HTTP concepts; non-HTTP entrypoints simply don't carry them. */
function httpData(profile: Profile): Partial<HttpRequestData> {
  return profile.entrypoint.data as Partial<HttpRequestData>;
}

function matchesMethod(profile: Profile, method?: string): boolean {
  if (!method) return true;
  return httpData(profile).method?.toUpperCase() === method.toUpperCase();
}

function matchesDuration(profile: Profile, min?: number, max?: number): boolean {
  const dur = profile.performance.duration ?? 0;
  return (min === undefined || dur >= min) && (max === undefined || dur <= max);
}

function matchesStatusAndUrl(profile: Profile, statusCode?: number, urlPattern?: string): boolean {
  if (statusCode !== undefined && profile.response?.statusCode !== statusCode) return false;
  return !(urlPattern && !httpData(profile).url?.toLowerCase().includes(urlPattern.toLowerCase()));
}

function matchesFilters(profile: Profile, options: StorageFindOptions): boolean {
  return (
    matchesMethod(profile, options.method) &&
    matchesDuration(profile, options.minDuration, options.maxDuration) &&
    matchesStatusAndUrl(profile, options.statusCode, options.urlPattern)
  );
}

export function applyProfileFilters<T = unknown>(
  profiles: Profile<T>[],
  options?: StorageFindOptions,
): Profile<T>[] {
  if (!options) return profiles;
  return profiles.filter((p) => matchesFilters(p, options));
}
