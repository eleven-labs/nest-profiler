import type { IProfilerCollector } from './collector.interface';
import type { Profile } from '../interfaces/profile.interface';
import { getCollectorEntries } from '../utils/collector.utils';

/**
 * ORM-agnostic base for query collectors (SQL, Mongoose, …).
 *
 * Each integration patches its own query surface and accumulates entries under a
 * private `queriesKey`. This base owns the rendering-side contract shared by every
 * query collector: the `Nq (M slow)` badge and the collect flow (drain the private
 * key, delete it from the profile, then hand the drained entries to {@link transform}).
 * Subclasses supply their `name`, their `queriesKey`, their panel `getTemplatePath()`,
 * and — when they need to post-process drained entries — a `transform` override.
 */
export abstract class AbstractQueryCollector<
  TEntry extends { isSlow: boolean },
> implements IProfilerCollector {
  /** Collector name — used as the panel id and the post-collect storage key. */
  abstract readonly name: string;
  /** Private profile.collectors key where the patch accumulates raw query entries. */
  protected abstract readonly queriesKey: string;

  /** Absolute path to the EJS panel template rendering the collected entries. */
  abstract getTemplatePath(): string;

  getBadgeValue(profile: Profile): string | null {
    const queries =
      (profile.collectors[this.name] as TEntry[] | undefined) ??
      getCollectorEntries<TEntry>(profile, this.queriesKey);
    if (!queries.length) return null;
    const slowCount = queries.filter((q) => q.isSlow).length;
    const badge = `${queries.length}q`;
    return slowCount > 0 ? `${badge} (${slowCount} slow)` : badge;
  }

  collect(profile: Profile): TEntry[] {
    const queries = getCollectorEntries<TEntry>(profile, this.queriesKey);
    delete profile.collectors[this.queriesKey];
    return this.transform(queries);
  }

  /** Post-process drained entries before they are stored. Identity by default. */
  protected transform(queries: TEntry[]): TEntry[] {
    return queries;
  }
}
