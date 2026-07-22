import { HTTP_ENTRYPOINT_TYPE } from '../interfaces/profile.interface';
import type { LifecyclePhase, Profile } from '../interfaces/profile.interface';

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
 * Assembles {@link Profile.lifecycle} — a flat breakdown of the request lifecycle (guards →
 * controller, plus validation) from the marks the guard, interceptor and validation pipe stamped.
 * Runs in `finalizeProfile` on every persist path (Apollo finish-hook included). `middleware` and
 * the network send have no clean NestJS hook, so they are absent.
 */
export function buildLifecycle(profile: Profile): void {
  const marks = lifecycleMarks(profile);
  const end = profile.performance.startTime + (profile.performance.duration ?? 0);
  const phases: LifecyclePhase[] = [];

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

  // Drop phases too fast to measure (0 ms at wall-clock resolution): a `guards` bar on a route with
  // no real guard, or an instant controller, is noise rather than signal.
  const meaningful = phases.filter((p) => p.duration > 0).sort((a, b) => a.startedAt - b.startedAt);
  if (meaningful.length > 0) profile.lifecycle = meaningful;
}
