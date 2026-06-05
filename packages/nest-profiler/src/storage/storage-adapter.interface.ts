import type { Profile } from '../interfaces/profile.interface';

export const PROFILER_STORAGE_ADAPTER = Symbol('PROFILER_STORAGE_ADAPTER');

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
}
