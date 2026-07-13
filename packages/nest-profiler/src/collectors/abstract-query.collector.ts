import * as path from 'path';
import type { IProfilerCollector } from './collector.interface';
import type {
  CollectorSummarySection,
  SummaryContext,
  SummaryTile,
} from './collector-summary.interface';
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

  /**
   * Label for one entry in the Summary's slowest-queries table (SQL text, `operation collection`…).
   * Return `''` to omit it (empty for all → no table). Override per ORM; the base contributes tiles only.
   */
  protected describeEntry(_entry: TEntry): string {
    return '';
  }

  /** Whether the {@link describeEntry} labels are SQL, so the summary table highlights them. */
  protected get summaryHighlight(): boolean {
    return false;
  }

  /**
   * Contributes a **Database** section: total queries, average time, slow-query count, plus a
   * slowest-queries table (top `context.topN`, default 5) when {@link describeEntry} yields labels.
   * Returns `undefined` when the window ran no queries.
   */
  buildSummary(profiles: Profile[], context?: SummaryContext): CollectorSummarySection | undefined {
    // Each entry paired with the token of the profile it ran in, for the drill-through link.
    const pairs: { entry: TEntry; token: string }[] = [];
    for (const profile of profiles) {
      const entries = profile.collectors[this.name] as TEntry[] | undefined;
      if (entries?.length) for (const entry of entries) pairs.push({ entry, token: profile.token });
    }
    if (pairs.length === 0) return undefined;

    const slowThreshold = this.getTagConfig().slowThreshold;
    const slow = pairs.filter((p) => p.entry.duration >= slowThreshold).length;
    const avgDuration = pairs.reduce((sum, p) => sum + p.entry.duration, 0) / pairs.length;
    const tiles: SummaryTile[] = [
      { label: 'Queries', value: String(pairs.length) },
      { label: 'Avg time', value: `${avgDuration.toFixed(1)} ms` },
      {
        // Only queries at/above the slow threshold (unlike the always-shown top-N table below).
        label: 'Slow queries',
        value: String(slow),
        hint: `≥ ${slowThreshold} ms`,
        severity: slow > 0 ? 'warning' : null,
      },
    ];

    const topN = Math.max(1, Math.floor(context?.topN ?? 5));
    const rows = [...pairs]
      .sort((a, b) => b.entry.duration - a.entry.duration)
      .slice(0, topN)
      .map((p) => ({
        label: this.describeEntry(p.entry),
        duration: p.entry.duration,
        token: p.token,
      }))
      .filter((r) => r.label !== '');

    // Detail-page tab a row links to: `?tab=database&subtab=typeorm` when grouped, else `?tab=<name>`.
    // `group`/`label` live on IProfilerCollector, not this abstract class, hence the cast.
    const group = (this as { group?: string }).group;
    const tab = group ?? this.name;
    const subtab = group ? this.name : undefined;

    return {
      name: this.name,
      label: (this as { label?: string }).label ?? this.name,
      tiles,
      ...(rows.length > 0
        ? {
            templatePath: path.join(__dirname, 'templates', 'query-summary.ejs'),
            data: { entries: rows, highlight: this.summaryHighlight, tab, subtab, limit: topN },
          }
        : {}),
    };
  }
}
