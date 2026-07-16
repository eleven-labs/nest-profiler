import { Injectable, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ProfilerCoreService } from './profiler-core.service';
import type { Profile } from '../interfaces/profile.interface';

/**
 * The main entry point for interacting with the profiler from your own code.
 *
 * Inject it anywhere to add custom **timeline spans** to the active request
 * profile, or to read the current debug token. Every method resolves the
 * current profile from the request-scoped CLS store, so a call made outside of
 * a profiled request (during bootstrap, in a background job, or when the
 * profiler is disabled) is a safe no-op rather than an error.
 *
 * Exceptions and the security context are captured automatically (by the
 * exception filter and `@eleven-labs/nest-profiler-auth`), so there is no
 * method to record them by hand.
 *
 * To capture logs, wrap your logger with the standalone
 * {@link createProfilerLogger} instead — it needs no `ProfilerService` and works
 * whether profiling is on or off.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class UserService {
 *   constructor(private readonly profiler: ProfilerService) {}
 *
 *   async findAll() {
 *     const stop = this.profiler.startSpan('db.findAll');
 *     try {
 *       return await this.repo.find();
 *     } finally {
 *       stop();
 *     }
 *   }
 * }
 * ```
 */
@Injectable()
export class ProfilerService {
  constructor(
    private readonly cls: ClsService,
    // Only available in the active (enabled) layer; undefined in the inert layer.
    @Optional() private readonly core?: ProfilerCoreService,
  ) {}

  /**
   * Awaits every profile persistence still in flight. Profiles are collected and
   * saved **after** the response is sent so they add no latency to profiled calls;
   * call this in tests (or before reading storage programmatically) to make sure
   * the profiles of completed requests are stored. Safe no-op when the profiler is
   * disabled.
   */
  async flush(): Promise<void> {
    await this.core?.flushPendingProfiles();
  }

  /**
   * Returns the debug token of the request currently being profiled, or
   * `undefined` when there is no active profile (outside a profiled request, or
   * when the profiler is disabled).
   *
   * The token identifies the profile in the toolbar and can be used to open its
   * page at `/_profiler/:token`.
   */
  getCurrentToken(): string | undefined {
    try {
      return this.cls.get<string | undefined>('profiler.token');
    } catch {
      return undefined;
    }
  }

  private getProfile(): Profile | undefined {
    try {
      return this.cls.get<Profile | undefined>('profiler.profile');
    } catch {
      return undefined;
    }
  }

  /**
   * Starts a **timeline span** and returns a function that closes it.
   *
   * Call the returned function once the measured work has finished: the elapsed
   * time is computed and the span is added to the active profile, where the
   * built-in Timeline collector renders it as a bar in the **Timeline** panel.
   * Wrap the stop call in a `finally` block so the span is recorded even when
   * the work throws. Calling outside a profiled request is a safe no-op — the
   * returned function still works but records nothing.
   *
   * @param phase - A short label for the measured work (e.g. `db.findAll`,
   *   `http.github`). Group related spans with a dotted prefix.
   * @returns A zero-argument function that stops the span and records its
   *   duration.
   *
   * @example
   * ```ts
   * const stop = profiler.startSpan('cache.warmup');
   * try {
   *   await warmCache();
   * } finally {
   *   stop();
   * }
   * ```
   */
  startSpan(phase: string): () => void {
    const startedAt = Date.now();
    return () => {
      const duration = Date.now() - startedAt;
      const profile = this.getProfile();
      if (!profile) return;
      (profile.spans ??= []).push({ phase, startedAt, duration });
    };
  }
}
