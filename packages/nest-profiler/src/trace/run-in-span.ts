import type { ClsService } from 'nestjs-cls';
import { readActiveSpanId, readProfile, setActiveSpanId } from '../services/profiler-context';
import { INERT_SPAN, TraceSpanDelegate } from './trace-span.delegate';
import type { SpanOutcome } from './trace-span.delegate';
import {
  appendManualSpan,
  nextSpanId,
  releaseOpenSpan,
  trackOpenSpan,
} from '../utils/profile-runtime-state';
import { nowMs, sinceMs } from '../utils/clock.utils';
import type { Profile } from '../interfaces/profile.interface';

/**
 * Opens a span against a profile and returns the delegate that closes it.
 *
 * The parent is read from the CLS store *now*, before any scope is opened: it is whatever span the
 * caller is running inside, which is exactly the causal link the trace needs.
 */
export function openSpan(
  cls: ClsService | undefined,
  profile: Profile,
  name: string,
): TraceSpanDelegate {
  const parentId = readActiveSpanId(cls);
  const startedAt = nowMs();
  const id = nextSpanId(profile);
  const meta: Record<string, string | number | boolean> = {};

  const delegate = new TraceSpanDelegate(id, name, meta, (outcome: SpanOutcome) => {
    releaseOpenSpan(profile, id);
    appendManualSpan(profile, {
      id,
      parentId,
      kind: outcome.kind ?? 'custom',
      label: name,
      startedAt,
      duration: sinceMs(startedAt),
      ...(outcome.status ? { status: outcome.status } : {}),
      ...(outcome.source ? { source: outcome.source } : {}),
      ...(outcome.tags?.length ? { tags: outcome.tags } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    });
  });

  trackOpenSpan(profile, delegate);
  return delegate;
}

/**
 * Runs `work` inside a new span and records it — the one implementation behind both
 * `TracerService.span()` and the `@Span()` method decorator.
 *
 * Shared rather than duplicated because the interesting part is not opening the span, it is
 * closing it in every way the work can end: a returned value, a thrown error, a rejected promise,
 * and the difference between the two moments an async callback "returns".
 *
 * @param cls - The CLS service, or `undefined` when the profiler is disabled.
 * @param name - Label for the span.
 * @param work - The measured work. Receives the span, for tags.
 */
export function runInSpan<T>(
  cls: ClsService | undefined,
  name: string,
  work: (span: TraceSpanDelegate) => T,
): T {
  const profile = readProfile(cls);
  // Nothing to record into: run the work unchanged, so annotated code behaves the same whether the
  // profiler is plugged in or not.
  if (!profile || !cls) return work(INERT_SPAN);

  const span = openSpan(cls, profile, name);
  // `ifNested: 'inherit'` is load-bearing: a bare `cls.run()` starts an *empty* store, which would
  // drop the profile, the token and the request for everything below this span — turning every
  // collector underneath into a silent no-op.
  return cls.run({ ifNested: 'inherit' }, () => {
    setActiveSpanId(cls, span.spanId);
    try {
      const result = work(span);
      // An async callback is only *started* here: closing the span on the synchronous return would
      // time how long it took to reach the first `await`, not the work. `end()` is idempotent, so
      // the settled handlers below are the single close in that case.
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(
          (value) => {
            span.end();
            return value;
          },
          (error: unknown) => {
            span.end({ status: 'error' });
            throw error;
          },
        ) as T;
      }
      span.end();
      return result;
    } catch (error) {
      span.end({ status: 'error' });
      throw error;
    }
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === 'function';
}
