import { HTTP_ENTRYPOINT_TYPE } from '../interfaces/profile.interface';
import type { Profile } from '../interfaces/profile.interface';
import type { RawSpan } from './build-trace';

/**
 * Transient per-request timestamps stamped by the guard, interceptor and validation pipe, held on
 * the profile under a `Symbol` so they never serialize. `buildLifecycle` turns them into the flat
 * {@link Profile.lifecycle} band once the request duration is known.
 */
export interface LifecycleMarks {
  guardsAt?: number;
  controllerAt?: number;
  validationStart?: number;
  validationEnd?: number;
}

const LIFECYCLE_MARKS = Symbol('nest_profiler_lifecycle_marks');

/** Returns the mutable marks holder on the profile, creating it on first access. */
export function lifecycleMarks(profile: Profile): LifecycleMarks {
  const holder = profile as unknown as Record<symbol, LifecycleMarks>;
  return (holder[LIFECYCLE_MARKS] ??= {});
}

/**
 * Turns the marks stamped by the guard, interceptor and validation pipe into the spans of the
 * **lifecycle band** — the flat, Symfony-profiler-style breakdown of the request (guards →
 * controller, plus validation) drawn above the causal waterfall.
 *
 * They are `TraceSpan`s like everything else, distinguished only by `lane: 'lifecycle'`. That is
 * the whole reason the previous `LifecyclePhase` interface is gone: a second model for "a piece
 * of work that took time" bought nothing but a second thing to keep in sync. The band exists as a
 * *rendering* choice because a framework phase spans most of the request and would otherwise
 * adopt every operation below it by time containment.
 *
 * `middleware` and the network send have no clean NestJS hook, so they are absent.
 */
export function buildLifecycleSpans(profile: Profile): RawSpan[] {
  const marks = lifecycleMarks(profile);
  const end = profile.performance.startTime + (profile.performance.duration ?? 0);
  const phases: { name: string; startedAt: number; duration: number }[] = [];

  // `guards`/`controller` come from the HTTP interceptor and guard, so they only make sense for a
  // plain HTTP request. GraphQL runs outside the interceptor (no controller boundary), so its
  // per-resolver guard would otherwise stretch `guards` across the whole request.
  const isHttp = profile.entrypoint.type === HTTP_ENTRYPOINT_TYPE;

  if (isHttp && marks.guardsAt !== undefined) {
    // Normally guards end where the controller begins; when a guard short-circuits the request
    // (a 401/403), the controller never runs, so the guards phase spans to the request's end.
    const guardsEnd = marks.controllerAt ?? end;
    phases.push({
      name: 'guards',
      startedAt: marks.guardsAt,
      duration: guardsEnd - marks.guardsAt,
    });
  }
  if (marks.validationStart !== undefined && marks.validationEnd !== undefined) {
    phases.push({
      name: 'validation',
      startedAt: marks.validationStart,
      duration: marks.validationEnd - marks.validationStart,
    });
  }
  if (isHttp && marks.controllerAt !== undefined) {
    phases.push({
      name: 'controller',
      startedAt: marks.controllerAt,
      duration: end - marks.controllerAt,
    });
  }

  // Drop phases too fast to measure: a `guards` bar on a route with no real guard, or an instant
  // controller, is noise rather than signal.
  return phases
    .filter((phase) => phase.duration > 0)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((phase) => ({
      kind: 'phase' as const,
      lane: 'lifecycle' as const,
      label: phase.name,
      startedAt: phase.startedAt,
      duration: phase.duration,
    }));
}
