import type { ProfilerTag } from '../analysis/profiler-tag.interface';
import type { TraceSpan, TraceSpanKind, TraceSpanStatus } from '../interfaces/profile.interface';

/**
 * The handle on an open span, handed to the callback of `TracerService.span()` and returned by
 * `TracerService.startSpan()`.
 *
 * Deliberately tiny. This is an object that appears in the middle of business code, so every
 * method on it is one the caller reads at a glance; it is not an extension point. Recording the
 * span is the tracer's job, not the delegate's — the delegate only carries what the caller wants
 * to say about the work while it is running.
 *
 * Every method is safe to call after the span has ended, and on the inert delegate handed out
 * when there is no profile to record into: the profiler is off in production by construction, and
 * an annotated method must not change behaviour depending on whether the tool is plugged in.
 */
export class TraceSpanDelegate {
  private ended = false;
  private failed = false;

  /**
   * @param id - Span id, also written to the CLS store so nested work reports it as its parent.
   *   Empty on the inert delegate.
   * @param name - Label rendered on the waterfall bar.
   * @param meta - The live `meta` bag of the span being built; mutated by {@link setTag}.
   * @param finish - Closes the span and records it. Undefined on the inert delegate.
   */
  constructor(
    private readonly id: string,
    private readonly name: string,
    private readonly meta: Record<string, string | number | boolean>,
    private readonly finish?: (outcome: SpanOutcome) => void,
  ) {}

  /** The span's id, as it appears in `TraceSpan.id` and in `LogEntry.spanId`. */
  get spanId(): string {
    return this.id;
  }

  /** The span's label. */
  get label(): string {
    return this.name;
  }

  /** Attaches one display-only value to the span (`rowCount`, `statusCode`, a domain id…). */
  setTag(key: string, value: string | number | boolean): this {
    this.meta[key] = value;
    return this;
  }

  /** Attaches several values at once. */
  addTags(tags: Record<string, string | number | boolean>): this {
    Object.assign(this.meta, tags);
    return this;
  }

  /**
   * Marks the span as failed without closing it — what `TracerService.captureError()` calls when
   * the application caught an error inside this span but carried on.
   */
  markFailed(): this {
    this.failed = true;
    return this;
  }

  /**
   * Closes the span and records it. Idempotent: a second call is ignored rather than recording
   * the span twice, so a `stop()` in a `finally` next to a `span()` wrapper is harmless.
   */
  end(outcome: SpanOutcome = {}): void {
    if (this.ended) return;
    this.ended = true;
    this.finish?.(this.failed ? { ...outcome, status: 'error' } : outcome);
  }
}

/** What the tracer learns about a span at the moment it closes. */
export interface SpanOutcome {
  status?: TraceSpanStatus;
  kind?: TraceSpanKind;
  tags?: ProfilerTag[];
  source?: TraceSpan['source'];
}

/**
 * The delegate handed out when there is nothing to record into — the profiler is disabled, or the
 * call happens outside a profiled execution (bootstrap, a background task).
 *
 * A single frozen-ish instance rather than a fresh object per call: on a disabled profiler this is
 * the *only* path, so it must cost nothing.
 */
export const INERT_SPAN = new TraceSpanDelegate('', '', {});
