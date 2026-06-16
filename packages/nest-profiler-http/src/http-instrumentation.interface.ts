import type { HttpProfilerRecorder } from './http-profiler-recorder.service';

/**
 * Pluggable HTTP-client integration. Implement this to teach the profiler how
 * to capture requests from a given client (axios ships built-in; fetch, got,
 * undici… can be added the same way), then register it via
 * `HttpCollectorModule.forRoot({ instrumentations: [MyInstrumentation] })`.
 *
 * Implementations are NestJS providers, so they may inject `ModuleRef`, config,
 * etc. through their constructor.
 */
export interface HttpInstrumentation {
  /**
   * Install hooks on the HTTP client. Called once at application bootstrap.
   * Use {@link HttpProfilerRecorder.record} to push captured requests to the
   * active profile. May be async (e.g. to resolve a provider first).
   */
  install(recorder: HttpProfilerRecorder): void | Promise<void>;
}
