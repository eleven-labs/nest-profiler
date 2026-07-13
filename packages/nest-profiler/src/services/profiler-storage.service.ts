import { Inject, Injectable, Optional } from '@nestjs/common';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';
import { PROFILER_STORAGE_ADAPTER } from '../storage/storage-adapter.interface';
import type {
  IProfilerStorageAdapter,
  StorageFindOptions,
} from '../storage/storage-adapter.interface';
import { MemoryStorageAdapter } from '../storage/memory-storage.adapter';
import type {
  IndexAttributesProvider,
  ProfileSummary,
  SummaryPrimitive,
} from '../storage/profile-summary';
import type { ProfilerPage, ProfilerQuery } from '../storage/profiler-query';
import { applyQueryInMemory, distinctInMemory, summariesInMemory } from '../storage/profiler-query';

@Injectable()
export class ProfilerStorageService {
  private readonly adapter: IProfilerStorageAdapter;
  /**
   * Supplies kind-specific index attributes for the in-memory `query`/`distinct`
   * fallback. Set by {@link ProfilerCoreService} so late-registered entrypoint
   * types (contributed in `onModuleInit`) are visible — the closure reads the
   * registry at call time.
   */
  private indexAttributes?: IndexAttributesProvider;

  constructor(
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
    @Optional()
    @Inject(PROFILER_STORAGE_ADAPTER)
    adapter?: IProfilerStorageAdapter,
  ) {
    this.adapter =
      adapter ?? new MemoryStorageAdapter({ maxProfiles: options.maxProfiles, ttl: options.ttl });
  }

  /**
   * Registers the projection used to compute summaries. Kept for the in-memory
   * `query`/`distinct` fallback and forwarded to the adapter when it maintains its
   * own summary index (a file or database adapter) so its native queries can filter
   * on kind-specific attributes.
   */
  setIndexAttributesProvider(provider: IndexAttributesProvider): void {
    this.indexAttributes = provider;
    this.adapter.setIndexAttributesProvider?.(provider);
  }

  /**
   * Whether the configured adapter persists profiles where another process can read them.
   * Defaults to `true` when the adapter does not declare the capability (custom adapters are
   * assumed to use a shared backing store).
   */
  get crossProcess(): boolean {
    return this.adapter.crossProcess ?? true;
  }

  save(profile: Profile): void | Promise<void> {
    return this.adapter.save(profile);
  }

  findAll(options?: StorageFindOptions): Profile[] | Promise<Profile[]> {
    return this.adapter.findAll(options);
  }

  findOne(token: string): Profile | undefined | Promise<Profile | undefined> {
    return this.adapter.findOne(token);
  }

  clear(): void | Promise<void> {
    return this.adapter.clear();
  }

  /** Releases the adapter's resources (e.g. a SQLite handle), if it holds any. */
  close(): void | Promise<void> {
    return this.adapter.close?.();
  }

  /**
   * Runs a structured list query. Delegates to the adapter's native {@link
   * IProfilerStorageAdapter.query} when present, otherwise fetches all profiles and
   * applies the query in memory.
   */
  async query(query: ProfilerQuery): Promise<ProfilerPage> {
    if (this.adapter.query) return this.adapter.query(query);
    return applyQueryInMemory(await this.adapter.findAll(), query, this.indexAttributes);
  }

  /**
   * Runs a structured query returning only the lightweight {@link ProfileSummary} rows of the
   * matching page — for aggregation views (the home Summary) that never need the full documents.
   * Delegates to the adapter's native {@link IProfilerStorageAdapter.querySummaries} when present
   * (an index-only read), otherwise summarizes {@link findAll} in memory.
   */
  async querySummaries(query: ProfilerQuery): Promise<ProfileSummary[]> {
    if (this.adapter.querySummaries) return this.adapter.querySummaries(query);
    return summariesInMemory(await this.adapter.findAll(), query, this.indexAttributes);
  }

  /** Distinct values of a summary field — native when the adapter supports it, else in-memory. */
  async distinct(field: string, typeIn?: string[]): Promise<SummaryPrimitive[]> {
    if (this.adapter.distinct) return this.adapter.distinct(field, typeIn);
    return distinctInMemory(await this.adapter.findAll(), field, this.indexAttributes, typeIn);
  }
}
