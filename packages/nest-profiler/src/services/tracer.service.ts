import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ProfilerCoreService } from './profiler-core.service';
import { readActiveSpanId, readProfile, readToken, readTraceId } from './profiler-context';
import { INERT_SPAN, TraceSpanDelegate } from '../trace/trace-span.delegate';
import { openSpan, runInSpan } from '../trace/run-in-span';
import { getOpenSpan } from '../utils/profile-runtime-state';
import { toExceptionEntry } from '../analysis/to-exception-entry';
import type { Profile } from '../interfaces/profile.interface';
import type { SummaryPrimitive } from '../storage/profile-summary';

/**
 * The one service to inject to talk to the profiler from your own code.
 *
 * It opens **trace spans** — the bars of the waterfall in the Performance tab — reports errors
 * your code caught itself, and reads the identifiers of the profile in flight. Everything else
 * the profiler records (queries, outgoing calls, exceptions that propagate, the security context)
 * is captured for you and needs no call.
 *
 * **Nothing here ever throws, and nothing here requires a profile to exist.** Outside a profiled
 * execution — during bootstrap, in a background task, or simply because the profiler is disabled,
 * which is how it should be deployed in production — every method is a no-op that returns the
 * same shape it otherwise would. A method annotated with a span must behave identically whether
 * the debugging tool is plugged in or not; that is a deliberate departure from `@nestjs/observe`,
 * whose equivalents throw when there is no active trace because an APM agent is expected to run
 * everywhere, always.
 *
 * To capture logs, wrap your logger with the standalone `createProfilerLogger` instead — it needs
 * no service and works whether profiling is on or off.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class ReviewService {
 *   constructor(private readonly tracer: TracerService) {}
 *
 *   async findForProduct(productId: string) {
 *     return this.tracer.span('reviews.findForProduct', async (span) => {
 *       span.setTag('productId', productId);
 *       const reviews = await this.repo.findBy({ productId });
 *       return span.setTag('count', reviews.length), reviews;
 *     });
 *   }
 * }
 * ```
 */
@Injectable()
export class TracerService {
  constructor(
    // Both optional: in the inert layer (`enabled: false`) neither is provided, and that is the
    // whole no-op story — there is no second class to keep in sync with this one.
    @Optional() private readonly cls?: ClsService,
    @Optional() @Inject(ProfilerCoreService) private readonly core?: ProfilerCoreService,
  ) {}

  /**
   * Runs `work` inside a new span and records it.
   *
   * The span is closed however `work` ends — returned value, thrown error, rejected promise — and
   * an error marks it `status: 'error'` before being re-thrown, so a failing branch is visible on
   * the waterfall instead of simply missing. The callback's value is returned unchanged.
   *
   * While `work` runs, this span is the **active** one: every query, outgoing call, log line and
   * nested `span()` issued underneath reports it as its parent, which is what makes the waterfall
   * a real tree rather than bars sorted by time. Prefer this form over {@link startSpan} for
   * exactly that reason.
   *
   * @param name - Label for the bar. Group related spans with a dotted prefix (`cache.warmup`).
   * @param work - The measured work. Receives the span, for tags.
   */
  span<T>(name: string, work: (span: TraceSpanDelegate) => T): T {
    return runInSpan(this.cls, name, work);
  }

  /**
   * Opens a span and hands back the delegate that closes it, for the case {@link span} cannot
   * express: work whose start and end are not in the same function (an event handler pair, a
   * stream opened here and consumed there).
   *
   * **It does not become the active span.** Making a span active means holding an async scope
   * open, and there is no scope to hold when the caller controls both ends independently — so
   * work started after this call is recorded as this span's *sibling*, not its child. That is the
   * honest behaviour, and the reason to reach for {@link span} whenever the shape allows it.
   *
   * Close it in a `finally` so the span is recorded even when the work throws.
   */
  startSpan(name: string): TraceSpanDelegate {
    const profile = this.profile();
    if (!profile) return INERT_SPAN;
    return openSpan(this.cls, profile, name);
  }

  /**
   * The span currently open, for code that wants to annotate the work it is inside without having
   * opened it. Returns an inert delegate — never `undefined`, never a throw — when there is no
   * active span, so callers need no guard.
   */
  activeSpan(): TraceSpanDelegate {
    const profile = this.profile();
    const id = readActiveSpanId(this.cls);
    if (!profile || !id) return INERT_SPAN;
    return getOpenSpan(profile, id) ?? INERT_SPAN;
  }

  /**
   * Records an error the application **caught and handled** — a call that fell back to a cache, a
   * retry that eventually succeeded, a deliberate degradation.
   *
   * Without this, such an error is invisible: the profiler's only source of exceptions is the
   * global filter, which sees exclusively what propagates out of the handler. The entry is marked
   * `handled`, so it shows in the Exceptions tab and on the span's bar without counting the
   * profile as failed — a request that recovered and answered 200 did not fail.
   *
   * @param error - The caught error.
   * @param tags - Extra context to attach to the active span (an account id, a retry count).
   */
  captureError(error: unknown, tags?: Record<string, string | number | boolean>): void {
    const profile = this.profile();
    if (!profile) return;

    profile.exceptions.push({
      ...toExceptionEntry(error, { sourceContext: this.core?.sourceContext }),
      handled: true,
    });

    const span = this.activeSpan();
    if (tags) span.addTags(tags);
    span.markFailed();
  }

  /**
   * Attaches a custom facet to the profile — a tenant, a feature-flag state, an experiment arm.
   *
   * These are the same attributes the `attributes` module option contributes, so a value written
   * here is **indexed and filterable from the profile list**, not merely readable during the
   * request. That is the point of writing one: "show me the slow requests of this tenant" is a
   * question the list can answer.
   */
  setAttribute(key: string, value: SummaryPrimitive): void {
    const profile = this.profile();
    if (!profile) return;
    (profile.attributes ??= {})[key] = value;
  }

  /** Reads back an attribute set by {@link setAttribute} or by the `attributes` module option. */
  getAttribute(key: string): SummaryPrimitive | undefined {
    return this.profile()?.attributes?.[key];
  }

  /**
   * The storage token of the profile in flight, or `undefined` outside one. This is what
   * addresses its page at `/_profiler/:token`.
   */
  currentToken(): string | undefined {
    return readToken(this.cls);
  }

  /**
   * The correlation id of the profile in flight, or `undefined` outside one.
   *
   * Unlike the token, this id is meant to leave the process: forward it on an outgoing call, or
   * print it in a log line, to be able to come back from an aggregator to this profile.
   */
  currentTraceId(): string | undefined {
    return readTraceId(this.cls);
  }

  /**
   * Awaits every profile persistence still in flight. Profiles are collected and saved **after**
   * the response is sent, so they add no latency; call this in tests (or before reading storage
   * programmatically) to be sure completed requests are stored. Safe no-op when disabled.
   */
  async flush(): Promise<void> {
    await this.core?.flushPendingProfiles();
  }

  private profile(): Profile | undefined {
    return readProfile(this.cls);
  }
}
