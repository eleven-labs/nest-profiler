import type { AxiosInstance } from 'axios';

/**
 * A single outgoing HTTP request captured during a profile, surfaced in the
 * shared "HTTP Client" panel.
 *
 * Client-agnostic by design: the bundled axios adapter produces these, but any
 * client (fetch, undici, got, a custom module…) can record the same shape via
 * {@link HttpProfilerRecorder} or {@link appendHttpRequestEntry}.
 */
export interface HttpRequestEntry {
  method: string;
  url: string;
  statusCode?: number;
  duration: number;
  startedAt: number;
  error?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
}

/**
 * Private `profile.collectors` key where instrumentations accumulate raw
 * {@link HttpRequestEntry} items before {@link HttpClientCollector.collect}
 * migrates them to the collector's public `http-client` key.
 */
export const HTTP_CLIENT_REQUESTS_KEY = '__http_client_requests';

/**
 * Raw request/response material handed to {@link HttpProfilerRecorder.capture},
 * which applies the configured {@link HttpCaptureOptions} (capture flags +
 * header masking) and builds the final {@link HttpRequestEntry}. Header bags may
 * be plain records, `fetch` `Headers`, a `Map`, or axios `AxiosHeaders`.
 */
export interface HttpCaptureInput {
  method: string;
  url: string;
  startedAt: number;
  duration: number;
  statusCode?: number;
  error?: string;
  requestHeaders?: unknown;
  requestBody?: unknown;
  responseHeaders?: unknown;
  responseBody?: unknown;
}

/**
 * Capture/redaction flags shared by every instrumentation so they expose the
 * same option surface.
 */
export interface HttpCaptureOptions {
  /**
   * Capture outgoing request headers. Default: `true`.
   * Sensitive headers are masked — see `maskHeaders`.
   */
  captureRequestHeaders?: boolean;

  /**
   * Capture outgoing request body for non-GET/HEAD methods. Default: `false`
   * (symmetry with `captureResponseBody`). Enable with caution — bodies may carry
   * secrets and can be large; captured bodies are passed through redaction.
   */
  captureRequestBody?: boolean;

  /**
   * Capture incoming response headers. Default: `true`.
   * Sensitive headers are masked — see `maskHeaders`.
   */
  captureResponseHeaders?: boolean;

  /**
   * Capture incoming response body. Default: `false`.
   * Enable with caution — response bodies can be large.
   */
  captureResponseBody?: boolean;

  /**
   * Header names (lowercase) whose values are replaced with `[REDACTED]`.
   * Merged with the built-in list: `authorization`, `cookie`, `set-cookie`,
   * `x-api-key`, `x-auth-token`, `proxy-authorization`.
   */
  maskHeaders?: string[];

  /**
   * The axios instance(s) to instrument, i.e. `HttpService.axiosRef`. This package never imports
   * `@nestjs/axios` (an optional dependency of your app, not of the profiler) — you provide the
   * ref, typically via {@link HttpCollectorModule.forRootAsync}:
   *
   * ```ts
   * HttpCollectorModule.forRootAsync({
   *   inject: [HttpService],
   *   useFactory: (http: HttpService) => ({ axiosRef: http.axiosRef }),
   * });
   * ```
   *
   * Pass an array to instrument several `HttpService` instances (per-feature `HttpModule`s).
   */
  axiosRef?: AxiosInstance | AxiosInstance[];
}
