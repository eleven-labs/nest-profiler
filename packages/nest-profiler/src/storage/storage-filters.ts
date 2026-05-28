import type { Profile } from '../interfaces/profile.interface';
import type { StorageFindOptions } from './storage-adapter.interface';

function matchesMethod(profile: Profile, method?: string): boolean {
  return !method || profile.request.method.toUpperCase() === method.toUpperCase();
}

function matchesDuration(profile: Profile, min?: number, max?: number): boolean {
  const dur = profile.performance.duration ?? 0;
  return (min === undefined || dur >= min) && (max === undefined || dur <= max);
}

function matchesStatusAndUrl(profile: Profile, statusCode?: number, urlPattern?: string): boolean {
  if (statusCode !== undefined && profile.response?.statusCode !== statusCode) return false;
  if (urlPattern && !profile.request.url.toLowerCase().includes(urlPattern.toLowerCase())) {
    return false;
  }
  return true;
}

function matchesFilters(profile: Profile, options: StorageFindOptions): boolean {
  return (
    matchesMethod(profile, options.method) &&
    matchesDuration(profile, options.minDuration, options.maxDuration) &&
    matchesStatusAndUrl(profile, options.statusCode, options.urlPattern)
  );
}

export function applyProfileFilters(profiles: Profile[], options?: StorageFindOptions): Profile[] {
  if (!options) return profiles;
  return profiles.filter((p) => matchesFilters(p, options));
}
