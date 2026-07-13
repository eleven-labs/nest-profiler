import type { Profile } from '../interfaces/profile.interface';
import type { TagSeverity } from '../analysis/profiler-tag.interface';
import type { CollectorSummarySection, SummaryContext } from './collector-summary.interface';

export interface IProfilerCollector {
  readonly name: string;
  readonly label?: string;
  readonly icon?: string;
  readonly priority?: number;
  /**
   * `'profile'` (default) — runs once per profile and attaches to whatever
   * entrypoint is active (HTTP request, CLI command, consumed message…) via the
   * CLS-stored profile, so collectors like DB, cache and HTTP-client work the
   * same across every entrypoint kind. `'global'` — runs once for the list page
   * (process-level data, e.g. configuration).
   */
  readonly scope?: 'profile' | 'global';
  readonly group?: string;
  readonly groupLabel?: string;
  readonly groupIcon?: string;
  readonly groupPriority?: number;
  getBadgeValue?(profile: Profile): string | number | null;
  /**
   * Worst performance-tag severity among this collector's entries, used to colour
   * its nav tab so a problematic panel stands out without cramming counts into the
   * badge. `null`/absent leaves the tab in its neutral style.
   */
  getBadgeSeverity?(profile: Profile): TagSeverity | null;
  getTemplatePath?(): string | undefined;
  collect(profile: Profile): unknown;
  /**
   * Contribute a section to the home **Summary** — the extension point for any collector. Read this
   * collector's entries over the bounded window and return {@link CollectorSummarySection | tiles
   * and/or a table}, or `undefined` for nothing. Isolated (a throw is swallowed); `context` carries
   * shared knobs like `topN`.
   */
  buildSummary?(profiles: Profile[], context?: SummaryContext): CollectorSummarySection | undefined;
}
