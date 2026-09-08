import type { Profile } from '../interfaces/profile.interface';
import type { RawSpan } from '../trace/build-trace';
import type { TraceSpanDelegate } from '../trace/trace-span.delegate';

/**
 * Transport plumbing attached to a profile for the length of the request, and to nothing else.
 *
 * Two facts the HTTP capture path has to carry from where it is learned to where it is used, and
 * that the profile *document* must never carry: they are not part of what a profile is, they must
 * not reach storage or the JSON export, and they are meaningless once the response is written.
 *
 * They used to be `Symbol` properties set on the `Profile` object, which kept them out of the
 * serialized document but cost a `as unknown as Record<symbol, unknown>` cast at every read and
 * write, and put request-scoped machinery on a domain object. A `WeakMap` keyed by the profile
 * gives the same isolation, typed, and the entry disappears with the profile it belongs to —
 * the same shape {@link markProfileStart} already uses for the resource baselines.
 */
interface ProfileRuntimeState {
  /**
   * Collection is deferred to the HTTP response-finish hook rather than run when a resolver
   * returns. See {@link deferCollectionToFinishHook}.
   */
  deferCollection: boolean;
  /**
   * Reads back the body the transport actually wrote. See {@link setTransportResponseBody}.
   */
  readTransportBody?: () => unknown;
  /**
   * Spans opened through `TracerService`, closed and waiting to be merged into the trace by
   * `buildTrace()`. Held here rather than on the profile because they are raw material: what the
   * stored document carries is `Profile.trace`, assembled from these *and* from every collector's
   * entries, not this list.
   */
  manualSpans: RawSpan[];
  /** Spans currently open, by id — what `TracerService.activeSpan()` resolves against. */
  openSpans: Map<string, TraceSpanDelegate>;
  /** Monotonic counter behind span ids; unique within a profile, which is all that is needed. */
  spanCounter: number;
}

const states = new WeakMap<Profile, ProfileRuntimeState>();

function stateOf(profile: Profile): ProfileRuntimeState {
  const existing = states.get(profile);
  if (existing) return existing;
  const created: ProfileRuntimeState = {
    deferCollection: false,
    manualSpans: [],
    openSpans: new Map(),
    spanCounter: 0,
  };
  states.set(profile, created);
  return created;
}

/**
 * Marks a profile whose collection must wait for the HTTP response-finish hook. Set by the
 * middleware once its `finish` listener is registered, so the non-HTTP (GraphQL) interceptor path
 * knows an HTTP hook will run `collectAll()` *after* every field resolver — otherwise
 * field-resolver DB queries, recorded once the root resolver has returned, would be drained too
 * early and never reach the collector panels.
 */
export function deferCollectionToFinishHook(profile: Profile): void {
  stateOf(profile).deferCollection = true;
}

/** Whether {@link deferCollectionToFinishHook} was called for this profile. */
export function isCollectionDeferred(profile: Profile): boolean {
  return states.get(profile)?.deferCollection === true;
}

/**
 * Publishes a getter for the body the transport actually wrote (`res.json()` / `res.send()` /
 * buffered `res.write()` chunks), installed by the middleware so the interceptor can recover the
 * real payload when the route handler emits something that is not one — the `@Res()` pattern,
 * where `return res.json(payload)` evaluates to the response object itself.
 */
export function setTransportResponseBody(profile: Profile, read: () => unknown): void {
  stateOf(profile).readTransportBody = read;
}

/**
 * The body the transport wrote, or `undefined` when nothing was captured for this profile (no
 * finish hook was installed, or the response carried no JSON-shaped payload).
 */
export function readTransportResponseBody(profile: Profile): unknown {
  return states.get(profile)?.readTransportBody?.();
}

/** Mints a span id unique within this profile. */
export function nextSpanId(profile: Profile): string {
  const state = stateOf(profile);
  return `s${(state.spanCounter += 1)}`;
}

/** Records a closed span, to be merged into the trace by `buildTrace()`. */
export function appendManualSpan(profile: Profile, span: RawSpan): void {
  stateOf(profile).manualSpans.push(span);
}

/** Every span closed so far on this profile. */
export function manualSpansOf(profile: Profile): RawSpan[] {
  return states.get(profile)?.manualSpans ?? [];
}

/** Registers a span as open, so `activeSpan()` can hand its delegate back. */
export function trackOpenSpan(profile: Profile, span: TraceSpanDelegate): void {
  stateOf(profile).openSpans.set(span.spanId, span);
}

/** The delegate of an open span, or `undefined` once it has closed. */
export function getOpenSpan(profile: Profile, id: string): TraceSpanDelegate | undefined {
  return states.get(profile)?.openSpans.get(id);
}

/** Forgets a span that has closed, so the map cannot grow for the life of the request. */
export function releaseOpenSpan(profile: Profile, id: string): void {
  states.get(profile)?.openSpans.delete(id);
}
