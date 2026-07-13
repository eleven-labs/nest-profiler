import { Inject, Injectable, Optional } from '@nestjs/common';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { ProfilerStorageService } from './profiler-storage.service';
import { CollectorRegistry } from '../collectors/collector-registry.service';
import type { CollectorSummarySection } from '../collectors/collector-summary.interface';
import { computeProfilerSummary, resolveErrorClassifier } from '../summary/profiler-summary';
import type { ProfilerSummary } from '../summary/profiler-summary';
import type { ProfileSummary } from '../storage/profile-summary';

/** Default window aggregated by the Summary — the most recent N profiles. Override with `summary.windowSize`. */
const DEFAULT_SUMMARY_WINDOW = 1000;

/** Default TTL (seconds) a computed summary is served from memory. Override with `summary.cacheTtl`. */
const DEFAULT_SUMMARY_TTL_SECONDS = 30;

/** Default per-table row cap for every Summary table. Override with `summary.topN`. */
const DEFAULT_SUMMARY_TOP_N = 5;

/** Window of **full** profiles loaded for domain sections; smaller since it materialises full documents. */
const DOMAIN_WINDOW_CAP = 500;

/**
 * Computes the home page's {@link ProfilerSummary} from a single bounded, index-only `querySummaries`
 * read, memoized for a short TTL. Also assembles the optional collector-contributed domain sections
 * (only when a collector opts in, from a bounded window of full profiles, cached the same way).
 */
@Injectable()
export class SummaryService {
  private readonly windowSize: number;
  private readonly ttlMs: number;
  private readonly topN: number;
  private readonly isError: (summary: ProfileSummary) => boolean;
  private cache?: { value: ProfilerSummary; expiresAt: number };
  private domainCache?: { value: CollectorSummarySection[]; expiresAt: number };

  constructor(
    private readonly storage: ProfilerStorageService,
    @Optional() private readonly collectorRegistry?: CollectorRegistry,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
  ) {
    this.windowSize = Math.max(1, options.summary?.windowSize ?? DEFAULT_SUMMARY_WINDOW);
    const ttlSeconds = options.summary?.cacheTtl ?? DEFAULT_SUMMARY_TTL_SECONDS;
    this.ttlMs = ttlSeconds > 0 ? ttlSeconds * 1000 : 0;
    this.topN = Math.max(1, Math.floor(options.summary?.topN ?? DEFAULT_SUMMARY_TOP_N));
    this.isError = resolveErrorClassifier(options.summary?.error);
  }

  /** The current aggregated summary, from cache when fresh, else recomputed from a bounded read. */
  async getSummary(): Promise<ProfilerSummary> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.value;

    const summaries = await this.storage.querySummaries({
      filters: [],
      page: 1,
      pageSize: this.windowSize,
    });
    const value = computeProfilerSummary(summaries, { topN: this.topN, isError: this.isError });
    // A non-positive TTL disables caching (recompute every load).
    if (this.ttlMs > 0) this.cache = { value, expiresAt: now + this.ttlMs };
    return value;
  }

  /**
   * The collector-contributed domain sections (tiles/tables). Empty — with no query cost — when no
   * collector implements `buildSummary`. Otherwise built from a bounded window of full profiles,
   * cached like {@link getSummary}.
   */
  async getDomainSections(): Promise<CollectorSummarySection[]> {
    if (!this.collectorRegistry?.hasSummaryContributors()) return [];

    const now = Date.now();
    if (this.domainCache && this.domainCache.expiresAt > now) return this.domainCache.value;

    const pageSize = Math.min(this.windowSize, DOMAIN_WINDOW_CAP);
    const page = await this.storage.query({ filters: [], page: 1, pageSize });
    const value = this.collectorRegistry.buildSummarySections(page.items, this.topN);
    if (this.ttlMs > 0) this.domainCache = { value, expiresAt: now + this.ttlMs };
    return value;
  }
}
