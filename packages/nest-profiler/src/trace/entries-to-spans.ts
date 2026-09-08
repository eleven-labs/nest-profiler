import type { RawSpan } from './build-trace';
import type { TaggableEntry } from '../analysis/taggable-collector.interface';
import type { TraceSpanKind } from '../interfaces/profile.interface';

/** How a collector projects one of its entries onto the trace. */
export interface EntrySpanOptions<TEntry> {
  /** Colour and grouping category of the produced spans. */
  kind: TraceSpanKind;
  /** Collector name, recorded on the span so a bar can link back to its row. */
  collector: string;
  /**
   * Detail panel the "open in panel" link targets — the collector's **group** when it is grouped
   * (`database` for the ORM collectors), else its own name. It is the panel a reader lands on, not
   * the collector, and the two differ precisely where several collectors share a tab.
   */
  tab?: string;
  /** The bar's label, e.g. the SQL text or `GET https://api.example.com/things`. */
  label: (entry: TEntry) => string;
  /** Extra values shown when the row is expanded (status code, row count…). */
  meta?: (entry: TEntry) => Record<string, string | number | boolean> | undefined;
  /** Whether the entry represents a failure. Defaults to "it carries an `error`". */
  isError?: (entry: TEntry) => boolean;
}

/**
 * Projects a collector's already-collected entries onto the trace.
 *
 * Nothing is re-timed: an entry already carries the `startedAt` and `duration` its instrumentation
 * measured, and the `parentSpanId` stamped when it was captured. This only reshapes them, which is
 * why a collector can feed the waterfall without its capture path knowing the trace exists.
 *
 * Entries with no `startedAt` are skipped rather than placed at the origin: a bar drawn at the
 * start of the request when nobody knows when it ran is worse than no bar at all.
 */
export function entriesToSpans<TEntry extends TaggableEntry>(
  entries: readonly TEntry[] | undefined,
  options: EntrySpanOptions<TEntry>,
): RawSpan[] {
  if (!entries?.length) return [];

  const failed = options.isError ?? ((entry: TEntry) => entry.error !== undefined);
  const spans: RawSpan[] = [];

  entries.forEach((entry, index) => {
    if (typeof entry.startedAt !== 'number') return;
    const meta = options.meta?.(entry);
    spans.push({
      kind: options.kind,
      label: options.label(entry),
      startedAt: entry.startedAt,
      duration: entry.duration,
      parentId: entry.parentSpanId,
      ...(failed(entry) ? { status: 'error' as const } : {}),
      // The tags the rule engine already applied to this entry (slow, N+1…). Surfaced on the bar
      // so the waterfall shows *which* call is the problem, not merely that the profile has one.
      ...(entry.tags?.length ? { tags: entry.tags } : {}),
      ...(meta && Object.keys(meta).length ? { meta } : {}),
      source: { collector: options.collector, index, tab: options.tab ?? options.collector },
    });
  });

  return spans;
}
