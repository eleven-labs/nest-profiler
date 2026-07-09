import type { IProfilerCollector } from './collector.interface';
import type { Profile } from '../interfaces/profile.interface';
import { getCollectorEntries } from '../utils/collector.utils';
import { maxTagSeverity } from '../analysis/profiler-tag.interface';
import type { TagSeverity } from '../analysis/profiler-tag.interface';
import type {
  TagConfig,
  TaggableCollector,
  TaggableEntry,
} from '../analysis/taggable-collector.interface';

/** Default per-collector thresholds, used when a subclass exposes no options. */
const DEFAULT_TAG_CONFIG: TagConfig = {
  slowThreshold: 100,
  nPlusOneThreshold: 2,
  chattyThreshold: 20,
};

/**
 * ORM-agnostic base for query collectors (SQL, Mongoose, …).
 *
 * Each integration patches its own query surface and accumulates entries under a
 * private `queriesKey`. This base owns the rendering-side contract shared by every
 * query collector: the `Nq (M slow, K N+1)` badge and the collect flow (drain the
 * private key, delete it from the profile, then hand the drained entries to
 * {@link transform}). It also implements {@link TaggableCollector} so the core
 * performance-rule engine can tag every query collector's entries uniformly;
 * subclasses override {@link getTagConfig} to feed their own thresholds.
 *
 * Subclasses supply their `name`, their `queriesKey`, their panel `getTemplatePath()`,
 * and — when they need to post-process drained entries — a `transform` override.
 */
export abstract class AbstractQueryCollector<TEntry extends TaggableEntry>
  implements IProfilerCollector, TaggableCollector
{
  /** Collector name — used as the panel id and the post-collect storage key. */
  abstract readonly name: string;
  /** Private profile.collectors key where the patch accumulates raw query entries. */
  protected abstract readonly queriesKey: string;
  /** Performance-rule domain; query collectors share the `'query'` domain. */
  readonly tagDomain: string = 'query';

  /** Absolute path to the EJS panel template rendering the collected entries. */
  abstract getTemplatePath(): string;

  getBadgeValue(profile: Profile): string | null {
    const queries = this.entriesOf(profile);
    return queries.length ? `${queries.length}q` : null;
  }

  /** Worst tag severity across the collected queries — colours the panel's nav tab. */
  getBadgeSeverity(profile: Profile): TagSeverity | null {
    return maxTagSeverity(this.entriesOf(profile));
  }

  private entriesOf(profile: Profile): TEntry[] {
    return (
      (profile.collectors[this.name] as TEntry[] | undefined) ??
      getCollectorEntries<TEntry>(profile, this.queriesKey)
    );
  }

  collect(profile: Profile): TEntry[] {
    const queries = getCollectorEntries<TEntry>(profile, this.queriesKey);
    delete profile.collectors[this.queriesKey];
    return this.transform(queries);
  }

  /** The collected entries, for the performance-rule engine (post-`collect`). */
  getTaggableEntries(profile: Profile): TEntry[] | undefined {
    return profile.collectors[this.name] as TEntry[] | undefined;
  }

  /** Thresholds for this collector's domain — override to read module options. */
  getTagConfig(): TagConfig {
    return DEFAULT_TAG_CONFIG;
  }

  /** Post-process drained entries before they are stored. Identity by default. */
  protected transform(queries: TEntry[]): TEntry[] {
    return queries;
  }
}
