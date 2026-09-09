import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerPage, ProfilerQuery } from './profiler-query';
import type { IndexAttributesProvider, SummaryPrimitive } from './profile-summary';

/**
 * DI token the resolved {@link IProfilerStorageAdapter} is provided under.
 *
 * Registered in the global symbol registry rather than created with a bare `Symbol()`: a token
 * has to keep one identity across every copy of this package that ends up in a dependency tree.
 * A bare symbol is unique per module instance, so two copies — a pnpm tree resolving a collector
 * against a different version of the core, or one day a dual CJS/ESM build — would provide under
 * one token and inject under another, and Nest would report the provider as simply missing.
 */
export const PROFILER_STORAGE_ADAPTER = Symbol.for('nest_profiler_storage_adapter');

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
  findAll(): Promise<Profile[]> | Profile[];
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

  /**
   * Optional: receive the projection that computes a profile's kind-specific index
   * attributes (a GraphQL `operationType`, a RabbitMQ `exchange`…). Adapters that
   * index/persist a {@link ProfileSummary} for native `query`/`distinct` need it to
   * populate `summary.attributes`. The profiler calls this once at startup, before
   * the first save. Adapters without a native query can ignore it (the service keeps
   * the provider for its in-memory fallback).
   */
  setIndexAttributesProvider?(provider: IndexAttributesProvider): void;

  /**
   * Optional: release any resources held by the adapter (database handle, file locks…). The
   * profiler calls it on application shutdown, after draining pending saves. Adapters holding
   * a native handle (e.g. SQLite) should implement it so the handle is closed and, for SQLite,
   * the WAL is checkpointed — otherwise the file may stay locked (Windows) or leak in tests.
   */
  close?(): Promise<void> | void;
}
