import { Logger } from '@nestjs/common';
import type { Profile, TraceSpan } from '../interfaces/profile.interface';
import type { IProfilerCollector } from '../collectors/collector.interface';
import { roundMs } from '../utils/clock';

const logger = new Logger('BuildTrace');

export const TRACE_ROOT_ID = 'root';

/** Wall-clock tolerance (ms) smoothing sub-millisecond rounding when testing containment. */
const EPSILON = 0.5;

/**
 * Kinds that may adopt children by time containment: a request, a lifecycle phase or a
 * GraphQL field genuinely *wraps* the work happening inside it. Every other kind is a leaf
 * operation (an outgoing call, a query…) — two of them overlapping means they ran
 * concurrently, not that one caused the other, so a leaf never becomes an inferred parent.
 * A leaf still gets children when the producer says so explicitly, via `parentId`.
 */
const CONTAINER_KINDS: ReadonlySet<string> = new Set(['entrypoint', 'phase', 'graphql-field']);

function isContainer(span: RawSpan): boolean {
  return span.container ?? CONTAINER_KINDS.has(span.kind);
}

/**
 * A span before its id and parent link are resolved. A producer that already knows
 * its id (e.g. a GraphQL field) supplies `id`/`parentId` so causal children can point
 * at it; everything else is nested by time containment.
 */
export interface RawSpan extends Omit<TraceSpan, 'id' | 'parentId'> {
  id?: string;
  parentId?: string;
  /**
   * Whether this span may adopt other spans by time containment. Defaults to the
   * {@link CONTAINER_KINDS} for its kind; a producer synthesizing its own wrapper
   * (an SQL transaction, a batch…) sets it explicitly.
   */
  container?: boolean;
}

/**
 * Opt-in contract letting a collector feed the unified trace by mapping its
 * already-collected entries to {@link RawSpan}s — no re-timing, it just reads the
 * `startedAt`/`duration` already on each entry.
 */
export interface TraceContributor {
  getTraceSpans(profile: Profile): RawSpan[];
}

/** Narrows a collector to one that contributes spans to the unified trace. */
export function isTraceContributor(
  collector: IProfilerCollector,
): collector is IProfilerCollector & TraceContributor {
  return typeof (collector as Partial<TraceContributor>).getTraceSpans === 'function';
}

interface IdentifiedSpan extends RawSpan {
  id: string;
  /** Emission order, the stable tie-break when two spans start on the same instant. */
  seq: number;
}

function entrypointLabel(profile: Profile): string {
  const data = profile.entrypoint.data as
    { method?: unknown; url?: unknown; name?: unknown } | undefined;
  if (data && typeof data.method === 'string' && typeof data.url === 'string') {
    return `${data.method} ${data.url}`;
  }
  // Commands and messages expose a name (the command name, the routing key…) rather than a URL.
  if (data && typeof data.name === 'string') return data.name;
  return profile.entrypoint.type;
}

function endOf(span: RawSpan): number {
  return span.startedAt + span.duration;
}

/**
 * Whether `child` started inside `parent`'s window, within {@link EPSILON} tolerance.
 *
 * Containment is judged on the start alone: a parent routinely stops being timed before the
 * work it triggered resolves (a phase closed on the synchronous return, a `BEGIN` the driver
 * reports as instantaneous), and requiring it to also outlast its child would orphan exactly
 * the spans that explain its cost. {@link reconcileWindows} then widens the parent onto what
 * it adopted, so the rendered bar covers its subtree.
 */
function contains(parent: RawSpan, child: RawSpan): boolean {
  return (
    parent.startedAt - EPSILON <= child.startedAt && child.startedAt <= endOf(parent) + EPSILON
  );
}

/**
 * Assembles the unified, causally-nested trace on `profile.trace`, once per profile
 * after collection and before save (mirrors {@link analyzeProfile}). Gathers raw spans
 * from the synthesized root, the lifecycle phases in {@link Profile.spans} and every
 * {@link TraceContributor}, then nests them: a reported `parentId` is exact, everything else
 * goes to the tightest enclosing container by time, falling back to the root. A last pass
 * widens every parent onto its children (see {@link reconcileWindows}). A throwing
 * contributor is isolated so one bad source cannot drop the trace.
 *
 * @param profile - The collected profile to assemble a trace for (mutated in place).
 * @param contributors - Every source contributing spans; each is called defensively.
 */
export function buildTrace(profile: Profile, contributors: readonly TraceContributor[]): void {
  const raw: RawSpan[] = [];

  for (const span of profile.spans ?? []) {
    raw.push({
      kind: 'phase',
      label: span.phase,
      startedAt: span.startedAt,
      duration: span.duration,
      parentId: span.parentSpanId,
    });
  }

  for (const contributor of contributors) {
    try {
      for (const span of contributor.getTraceSpans(profile)) raw.push(span);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Trace contributor failed: ${message}`);
    }
  }

  // Root duration falls back to spanning the observed children when absent.
  const startTime = profile.performance.startTime;
  const observedEnd = raw.reduce((max, s) => Math.max(max, endOf(s)), startTime);
  const rootDuration = profile.performance.duration ?? observedEnd - startTime;
  const root: TraceSpan = {
    id: TRACE_ROOT_ID,
    kind: 'entrypoint',
    label: entrypointLabel(profile),
    startedAt: startTime,
    duration: Math.max(rootDuration, 0),
  };

  // Honour a producer id (deduplicated), else synthesize a globally-unique one so
  // two 'db' collectors never collide.
  const used = new Set<string>([TRACE_ROOT_ID]);
  const identified: IdentifiedSpan[] = [];
  let counter = 0;
  for (const span of raw) {
    let id = span.id;
    if (!id || used.has(id)) id = `${span.kind}-${counter}`;
    while (used.has(id)) id = `${span.kind}-${++counter}`;
    used.add(id);
    identified.push({ ...span, id, seq: counter });
    counter++;
  }

  // Parenting order — parents before children: earliest start first, longest (enclosing)
  // first on ties. Containers go in a first wave: since a parent may be timed shorter than
  // the child it triggered, duration alone no longer orders parent before child. Kept
  // separate from the emission order so the rendered order below can stay chronological
  // (a 0ms COMMIT must not jump ahead of the START TRANSACTION it closes).
  const byStart = [...identified].sort(
    (a, b) => a.startedAt - b.startedAt || b.duration - a.duration || a.seq - b.seq,
  );
  const byContainment = [
    ...byStart.filter((span) => isContainer(span)),
    ...byStart.filter((span) => !isContainer(span)),
  ];

  const placed: IdentifiedSpan[] = [{ ...root, seq: -1 }];
  const parents = new Map<string, string>();

  /** Whether `id` is `ancestorId` or sits below it in the tree built so far. */
  const descendsFrom = (id: string, ancestorId: string): boolean => {
    let current: string | undefined = id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = parents.get(current);
    }
    return false;
  };

  for (const span of byContainment) {
    // A reported parent is exact and always wins. It is the only causal signal that survives
    // concurrency: spans resolved in parallel (GraphQL fields under one selection set, phases
    // opened inside them) enclose each other in time purely by accident, and time alone would
    // chain them into a fictitious ancestry. Time containment only decides for spans that
    // report nothing.
    if (span.parentId && span.parentId !== span.id && used.has(span.parentId)) {
      parents.set(span.id, span.parentId);
      placed.push(span);
      continue;
    }

    // Tightest enclosing container: smallest duration, then latest start.
    let parentId = TRACE_ROOT_ID;
    let best: IdentifiedSpan | undefined;
    for (const candidate of placed) {
      if (candidate.id === span.id || !isContainer(candidate) || !contains(candidate, span))
        continue;
      if (!best || candidate.duration < best.duration) {
        best = candidate;
      } else if (candidate.duration === best.duration) {
        // Same window: the deeper container wins, so a phase opened inside another phase
        // keeps the work rather than handing it back to its own parent.
        if (candidate.startedAt > best.startedAt || descendsFrom(candidate.id, best.id)) {
          best = candidate;
        }
      }
    }
    if (best) parentId = best.id;

    parents.set(span.id, parentId);
    placed.push(span);
  }

  // Emitted chronologically, emission order breaking ties, so the flat array already reads
  // in causal order and the UI needs no duration-based sibling sort.
  const result: TraceSpan[] = [root];
  const ordered = [...identified].sort((a, b) => a.startedAt - b.startedAt || a.seq - b.seq);

  for (const span of ordered) {
    const parentId = parents.get(span.id) ?? TRACE_ROOT_ID;

    const resolved: TraceSpan = {
      id: span.id,
      parentId,
      kind: span.kind,
      label: span.label,
      startedAt: span.startedAt,
      duration: span.duration,
      ...(span.status ? { status: span.status } : {}),
      ...(span.source ? { source: span.source } : {}),
      ...(span.tags?.length ? { tags: span.tags } : {}),
      ...(span.meta ? { meta: span.meta } : {}),
    };
    result.push(resolved);
  }

  reconcileWindows(result);
  profile.trace = result;
}

/**
 * Widens every parent so its window covers its children's, deepest first.
 *
 * A parent is only timed around what it *knows* it does: a phase closed before its last
 * query resolved, a driver reporting a `BEGIN` as instantaneous. Left alone, such a parent
 * renders as a 0ms bar with visibly longer work hanging under it — the number reads as
 * "this cost nothing" when it really means "this was not measured end to end". Windows are
 * only ever widened, never shrunk, so a correctly-timed parent is untouched.
 */
function reconcileWindows(spans: readonly TraceSpan[]): void {
  const byId = new Map(spans.map((span) => [span.id, span]));

  const depthOf = (span: TraceSpan): number => {
    let depth = 0;
    let current = span.parentId ? byId.get(span.parentId) : undefined;
    const seen = new Set<string>([span.id]);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      depth++;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return depth;
  };

  const depths = new Map(spans.map((span) => [span.id, depthOf(span)]));
  const deepestFirst = [...spans].sort((a, b) => (depths.get(b.id) ?? 0) - (depths.get(a.id) ?? 0));

  for (const span of deepestFirst) {
    const parent = span.parentId ? byId.get(span.parentId) : undefined;
    if (!parent) continue;
    const start = Math.min(parent.startedAt, span.startedAt);
    const end = Math.max(parent.startedAt + parent.duration, span.startedAt + span.duration);
    parent.startedAt = roundMs(start);
    parent.duration = roundMs(end - start);
  }
}
