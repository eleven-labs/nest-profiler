import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ProfilerCollector } from '@eleven-labs/nest-profiler';
import type {
  IProfilerCollector,
  Profile,
  RawSpan,
  TraceContributor,
} from '@eleven-labs/nest-profiler';
import { entriesToSpans, getCollectorEntries } from '@eleven-labs/nest-profiler';
import type { CacheOperationEntry } from './cache-collector.interface';
import { CACHE_OPERATIONS_KEY } from './cache-collector.interface';

const CACHE_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="6.5" width="14" height="3" rx="1" opacity="0.7"/><rect x="1" y="11" width="14" height="3" rx="1" opacity="0.4"/></svg>`;

@Injectable()
@ProfilerCollector({ name: 'cache', label: 'Cache', icon: CACHE_ICON, priority: 30 })
export class CacheCollector implements IProfilerCollector, TraceContributor {
  readonly name = 'cache';
  readonly label = 'Cache';
  readonly icon = CACHE_ICON;
  readonly priority = 30;

  getBadgeValue(profile: Profile): string | null {
    const ops =
      (profile.collectors[this.name] as CacheOperationEntry[] | undefined) ??
      getCollectorEntries<CacheOperationEntry>(profile, CACHE_OPERATIONS_KEY);
    if (!ops.length) return null;
    const hits = ops.filter((o) => o.operation === 'GET_HIT').length;
    const misses = ops.filter((o) => o.operation === 'GET_MISS').length;
    if (hits === 0 && misses === 0) return `${ops.length}ops`;
    return `${hits}H/${misses}M`;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'cache-panel.ejs');
  }

  collect(profile: Profile): CacheOperationEntry[] {
    const ops = getCollectorEntries<CacheOperationEntry>(profile, CACHE_OPERATIONS_KEY);
    delete profile.collectors[CACHE_OPERATIONS_KEY];
    return ops;
  }

  /**
   * Projects each cache operation onto the unified trace.
   *
   * Worth a bar of its own even though cache calls are fast: a miss is what *explains* the query
   * or the outgoing call drawn right after it, and seeing the two next to each other on one axis
   * is the whole point of merging them.
   */
  getTraceSpans(profile: Profile): RawSpan[] {
    return entriesToSpans(profile.collectors[this.name] as CacheOperationEntry[] | undefined, {
      kind: 'cache',
      collector: this.name,
      label: (entry) => `${entry.operation} ${entry.key}`,
      meta: (entry) => ({ operation: entry.operation }),
    });
  }
}
