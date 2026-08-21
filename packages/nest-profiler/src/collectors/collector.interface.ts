import type { Profile } from '../interfaces/profile.interface';
import type { TagSeverity } from '../analysis/profiler-tag.interface';

/**
 * One sidebar view contributed by a `scope: 'global'` collector. A global collector renders a
 * single panel by default; implementing {@link IProfilerCollector.expandGlobalPanels} lets it
 * split its snapshot into several views instead — the Routes collector emits one **Discover**
 * view per transport rather than one panel aggregating them all.
 */
export interface GlobalPanelDescriptor {
  /** View key, used as `?view=` — must be unique across list sections and global panels. */
  name: string;
  label: string;
  icon?: string;
  /** The slice of the collector's snapshot this view renders. */
  data: unknown;
  templatePath?: string;
  /** Sidebar count badge. */
  badge?: number;
  /** Sidebar group key the view is filed under (e.g. `'discover'`); ungrouped when absent. */
  group?: string;
  /** Human label of that group, shown as the sidebar group heading (e.g. `'Discover'`). */
  groupLabel?: string;
}

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
  /**
   * Splits a `scope: 'global'` collector's snapshot into several sidebar views instead of the
   * single panel it would otherwise render — it receives the value `collect()` returned. An
   * empty array hides the collector from the sidebar entirely; omitting the method keeps the
   * default single-panel behaviour. Ignored for `scope: 'profile'` collectors.
   */
  expandGlobalPanels?(data: unknown): GlobalPanelDescriptor[];
  collect(profile: Profile): unknown;
}
