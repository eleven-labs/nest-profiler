import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type {
  EventEntry,
  ExceptionEntry,
  LogEntry,
  Profile,
  SecurityContext,
} from '../interfaces/profile.interface';
import { createProfilerLogger } from './profiler-logger-adapter';
import type { LogMethodMap } from './profiler-logger-adapter';

/**
 * The main entry point for interacting with the profiler from your own code.
 *
 * Inject it anywhere to enrich the **active request profile** — add custom
 * timeline spans, log entries, events, exceptions or security context. Every
 * method resolves the current profile from the request-scoped CLS store, so a
 * call made outside of a profiled request (during bootstrap, in a background
 * job, or when the profiler is disabled) is a safe no-op rather than an error.
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
  constructor(private readonly cls: ClsService) {}

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
   * Appends a log entry to the active profile's **Logs** panel.
   *
   * Prefer {@link createLogger} to capture an existing logger transparently;
   * use this only to record bespoke lines that do not flow through a
   * `LoggerService`.
   *
   * @param entry - The log entry (level, message, timestamp, optional context).
   */
  addLog(entry: LogEntry): void {
    this.getProfile()?.logs.push(entry);
  }

  /**
   * Records an exception in the active profile's **Exceptions** panel.
   *
   * @param entry - The captured exception (name, message, stack, timestamp).
   */
  addException(entry: ExceptionEntry): void {
    this.getProfile()?.exceptions.push(entry);
  }

  /**
   * Appends a timeline **event** — a point-in-time marker, as opposed to a
   * {@link startSpan | span} that has a duration — to the active profile.
   *
   * @param entry - The event to record (name and timestamp).
   */
  addEvent(entry: EventEntry): void {
    const profile = this.getProfile();
    if (!profile) return;
    (profile.events ??= []).push(entry);
  }

  /**
   * Sets the security context (authenticated user, roles, JWT claims…) shown in
   * the **Security** panel, replacing any context previously set for the
   * request. Usually populated by `@eleven-labs/nest-profiler-auth`, but you can
   * call it directly to surface custom auth data.
   *
   * @param data - The security context to attach to the active profile.
   */
  setSecurityContext(data: SecurityContext): void {
    const profile = this.getProfile();
    if (!profile) return;
    profile.security = data;
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

  /**
   * Wraps any logger transparently: log calls are captured into the active
   * profile's **Logs** panel while still being forwarded to the real logger.
   *
   * The returned value is a `Proxy` with the same type as the delegate, so it is
   * a drop-in replacement — pass it to `app.useLogger()` or inject it wherever
   * the original logger was used. When there is no active profile the call is
   * simply forwarded, so no log lines are lost.
   *
   * @typeParam T - The logger's type, preserved on the returned proxy.
   * @param delegate - The underlying logger to forward to (the Nest `Logger`, a
   *   `nestjs-pino` logger, or any custom `LoggerService`).
   * @param logMethods - Optional map overriding which methods are intercepted and
   *   at what level. Defaults to `DEFAULT_LOG_METHODS` (NestJS + pino + winston).
   * @returns A proxy of `delegate` that records every intercepted log call.
   *
   * @example
   * ```ts
   * const pino = app.get(Logger);
   * app.useLogger(profiler.createLogger(pino));
   * ```
   */
  createLogger<T extends object>(delegate: T, logMethods?: LogMethodMap): T {
    return createProfilerLogger(delegate, this, logMethods);
  }
}
