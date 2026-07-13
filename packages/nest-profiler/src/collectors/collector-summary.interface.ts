import type { TagSeverity } from '../analysis/profiler-tag.interface';

/** Shared knobs passed to {@link IProfilerCollector.buildSummary}. */
export interface SummaryContext {
  /** Per-table row cap (the `summary.topN` option); `undefined` means the default of 5. */
  readonly topN?: number;
}

/**
 * A single metric shown as a card in a collector's Summary section — e.g. "DB queries: 128" or
 * "Cache hit rate: 92%". Purely presentational; the collector computes `value` from the window.
 */
export interface SummaryTile {
  /** Short uppercase label, e.g. `'DB queries'`. */
  readonly label: string;
  /** Pre-formatted value, e.g. `'128'`, `'92%'`, `'3.2 / req'`. */
  readonly value: string;
  /** Optional secondary line under the value. */
  readonly hint?: string;
  /** Optional severity, colouring the tile when a threshold is crossed. */
  readonly severity?: TagSeverity | null;
}

/**
 * A collector's contribution to the home **Summary**, returned by {@link IProfilerCollector.buildSummary}:
 * a titled section of metric {@link SummaryTile | tiles} and/or a custom EJS block via `templatePath`
 * + `data` (same mechanism as the detail-page panels). A section with neither is dropped.
 */
export interface CollectorSummarySection {
  /** Stable id (defaults to the collector name), used as the section key. */
  readonly name: string;
  /** Section heading, e.g. `'Database'`. */
  readonly label: string;
  /** Inline SVG markup for the section icon. */
  readonly icon?: string;
  /** Metric cards for this section. */
  readonly tiles?: readonly SummaryTile[];
  /**
   * Absolute path to an EJS partial rendering a custom block (a table…). Receives `{ data }` plus
   * the shared template helpers, exactly like a detail-page collector panel.
   */
  readonly templatePath?: string;
  /** Data handed to {@link templatePath}. */
  readonly data?: unknown;
}
