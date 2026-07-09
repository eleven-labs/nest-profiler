/**
 * Severity of a {@link ProfilerTag}, in ascending order of concern. Drives the
 * badge colour in the UI and, when the same tag id is aggregated onto a profile,
 * the winning severity is the highest one seen.
 */
export type TagSeverity = 'info' | 'warning' | 'danger';

/** Numeric rank per {@link TagSeverity}, so aggregation can keep the highest. */
export const TAG_SEVERITY_RANK: Record<TagSeverity, number> = {
  info: 0,
  warning: 1,
  danger: 2,
};

/**
 * A structured performance tag attached to a collected entry (a SQL/Mongo query,
 * an outgoing HTTP call…) or aggregated onto a {@link Profile}. Produced by the
 * performance-rule engine ({@link analyzeProfile}) and rendered as a coloured pill
 * in the panels, the profile header and the list page.
 */
export interface ProfilerTag {
  /** Stable id — used for CSS class, list filtering and dedup. e.g. `'slow'`. */
  id: string;
  /** Human label shown on the pill, e.g. `'N+1 ×5'` or `'Slow'`. */
  label: string;
  severity: TagSeverity;
  /** Multiplicity for group tags (N+1, chatty). Absent for boolean tags. */
  count?: number;
  /** Optional tooltip detail (shown on hover). */
  detail?: string;
}

/** Built-in tag ids emitted by {@link BUILTIN_PERFORMANCE_RULES}. */
export const BUILTIN_TAG_IDS = {
  slow: 'slow',
  nPlusOne: 'n-plus-one',
  error: 'error',
  chatty: 'chatty',
  largePayload: 'large-payload',
} as const;

export type BuiltinTagId = (typeof BUILTIN_TAG_IDS)[keyof typeof BUILTIN_TAG_IDS];

/**
 * The highest {@link TagSeverity} across the tags carried by a set of entries (or
 * a single tag list), or `null` when nothing is tagged. Used to colour a collector
 * tab / the performance banner by its worst issue.
 */
export function maxTagSeverity(
  items: ReadonlyArray<{ tags?: ProfilerTag[] }> | undefined,
): TagSeverity | null {
  let best: TagSeverity | null = null;
  for (const item of items ?? []) {
    for (const tag of item.tags ?? []) {
      if (best === null || TAG_SEVERITY_RANK[tag.severity] > TAG_SEVERITY_RANK[best]) {
        best = tag.severity;
      }
    }
  }
  return best;
}

/**
 * Adds `tag` to `list`, deduplicating by {@link ProfilerTag.id}: when an entry
 * already carries a tag with the same id, the one with the higher severity wins
 * and the larger `count` is kept — so re-running a rule (or aggregating across
 * collectors) never produces duplicate pills.
 */
export function upsertTag(list: ProfilerTag[], tag: ProfilerTag): void {
  const existing = list.find((t) => t.id === tag.id);
  if (!existing) {
    list.push({ ...tag });
    return;
  }
  if (TAG_SEVERITY_RANK[tag.severity] > TAG_SEVERITY_RANK[existing.severity]) {
    existing.severity = tag.severity;
    existing.label = tag.label;
    existing.detail = tag.detail;
  }
  if (tag.count != null) {
    existing.count = Math.max(existing.count ?? 0, tag.count);
  }
}
