import type { Profile } from '../interfaces/profile.interface';

/**
 * Returns the typed collector entries array for the given key.
 * Returns an empty array if no entries exist yet.
 */
export function getCollectorEntries<T>(profile: Profile, key: string): T[] {
  const raw = profile.collectors[key];
  return Array.isArray(raw) ? (raw as T[]) : [];
}

/**
 * Appends a single entry to the collector list, initialising the array on first call.
 */
export function appendCollectorEntry<T>(profile: Profile, key: string, entry: T): void {
  const list = getCollectorEntries<T>(profile, key);
  if (!Array.isArray(profile.collectors[key])) {
    profile.collectors[key] = list;
  }
  list.push(entry);
}
