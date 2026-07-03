import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerPage, ProfilerQuery } from './profiler-query';
import type { SummaryPrimitive } from './profile-summary';

export const PROFILER_STORAGE_ADAPTER = Symbol('PROFILER_STORAGE_ADAPTER');

/**
 * @deprecated Superseded by {@link ProfilerQuery} / {@link IProfilerStorageAdapter.query}.
 * The dashboard no longer passes these HTTP-centric options; kept only for
 * backwards compatibility with custom adapters.
 */
export interface StorageFindOptions {
  method?: string;
  statusCode?: number;
  minDuration?: number;
  maxDuration?: number;
  urlPattern?: string;
}

export interface IProfilerStorageAdapter {
  /**
   * Whether profiles persisted by this adapter are visible to other processes — e.g. a
   * profile written by a CLI command process being read by a separate web server process.
   * Backing stores that are shared (file system, Redis, a database) are cross-process;
   * an in-memory store is not. Omitted means "assume shared" (the common case for custom
   * adapters). The CLI command profiler uses this to warn when commands are persisted to a
   * process-local store, where they would never appear in the web profiler.
   */
  readonly crossProcess?: boolean;
  save(profile: Profile): Promise<void> | void;
  findAll(options?: StorageFindOptions): Promise<Profile[]> | Profile[];
  findOne(token: string): Promise<Profile | undefined> | Profile | undefined;
  clear(): Promise<void> | void;

  /**
   * Optional: run a structured list query (section + filters + sort + pagination)
   * natively, returning the page of profiles and the total match count. Implement
   * this for stores that can filter/paginate efficiently (a database, Redis…) so a
   * list render never loads every profile. When omitted, {@link ProfilerStorageService}
   * falls back to fetching all profiles and applying the query in memory — correct
   * but not scalable, fine for the in-memory adapter.
   */
  query?(query: ProfilerQuery): Promise<ProfilerPage> | ProfilerPage;

  /**
   * Optional: return the distinct, non-empty values of a summary `field` (optionally
   * restricted to `typeIn`), used to populate a filter's dynamic `select` options.
   * Falls back to deriving them from {@link findAll} when omitted.
   */
  distinct?(field: string, typeIn?: string[]): Promise<SummaryPrimitive[]> | SummaryPrimitive[];
}
