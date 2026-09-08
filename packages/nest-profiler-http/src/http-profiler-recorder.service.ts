import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type {
  HttpCaptureInput,
  HttpCaptureOptions,
  HttpRequestEntry,
} from './http-request.interface';
import { redact, tryResolve } from '@eleven-labs/nest-profiler';
import { appendHttpRequestEntry } from './append-http-request-entry.util';
import { hasHttpPhases } from './http-phases.interface';
import {
  DEFAULT_MASK_HEADERS,
  extractHeaders,
  redactQueryString,
  resolveMaskedQueryParams,
} from './http-redaction.util';
import { HTTP_COLLECTOR_OPTIONS } from './http-collector.constants';
import { outgoingTraceId, resolveTraceIdHeader } from './propagate-trace-id';

/**
 * Injectable façade for recording outgoing HTTP requests into the active
 * profile. This is the API to reach for from application code or a custom
 * instrumentation: inject it and call {@link capture} with the raw
 * request/response material — it applies the configured capture flags and
 * header masking for you. The bundled axios adapter uses it too.
 */
@Injectable()
export class HttpProfilerRecorder implements OnModuleInit {
  /** Built-in mask list merged with the configured `maskHeaders`. */
  readonly maskHeaders: string[];
  /** Query-parameter names whose value is masked in the recorded URL. */
  private readonly maskQueryParams: ReadonlySet<string>;
  /** Resolved lazily so a disabled core (no ClsModule) degrades to a no-op recorder. */
  private cls: ClsService | undefined;
  /** Header the trace id is forwarded on, or `undefined` when propagation is off. */
  readonly traceIdHeader: string | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(HTTP_COLLECTOR_OPTIONS) readonly options: HttpCaptureOptions,
  ) {
    this.maskHeaders = [...DEFAULT_MASK_HEADERS, ...(options.maskHeaders ?? [])];
    this.maskQueryParams = resolveMaskedQueryParams(options);
    this.traceIdHeader = resolveTraceIdHeader(options.propagateTraceId);
  }

  /**
   * The trace id to forward on an outgoing call, or `undefined` when propagation is off or the
   * call happens outside a profiled request.
   *
   * Exposed on the recorder rather than read by each instrumentation: axios and fetch — and any
   * custom client wired through {@link capture} — then forward the same id under the same header,
   * decided in one place.
   */
  outgoingTraceId(): string | undefined {
    return outgoingTraceId(this.resolveCls(), this.traceIdHeader);
  }

  onModuleInit(): void {
    this.resolveCls();
  }

  /** Lazily resolves ClsService via ModuleRef (undefined when the core is disabled). */
  private resolveCls(): ClsService | undefined {
    return (this.cls ??= tryResolve<ClsService>(this.moduleRef, ClsService));
  }

  /**
   * Build an {@link HttpRequestEntry} from raw request/response material,
   * honouring the configured {@link HttpCaptureOptions} (header/body capture
   * flags) and masking sensitive headers, then record it. This is the
   * recommended entry point: it guarantees a custom client captures the same
   * request/response detail — shown in the panel — as the bundled axios adapter.
   */
  capture(input: HttpCaptureInput): void {
    const opts = this.options;
    const method = input.method.toUpperCase();

    const entry: HttpRequestEntry = {
      method,
      // Masked here, at capture: the URL is persisted, rendered in the panel and exported by
      // `/:token/data`, so an upstream API key in a query parameter would be readable
      // everywhere the profile is. The N+1 fingerprint drops the query string entirely, so
      // grouping is unaffected.
      url: redactQueryString(input.url, this.maskQueryParams),
      statusCode: input.statusCode,
      duration: input.duration,
      startedAt: input.startedAt,
      error: input.error,
    };

    // Copied, not referenced: a provider keeps refining the breakdown it measured (undici fills
    // `download` when the body ends), and an entry already recorded must stop changing.
    if (hasHttpPhases(input.phases)) entry.phases = { ...input.phases };

    if (opts.captureRequestHeaders !== false && input.requestHeaders != null) {
      entry.requestHeaders = extractHeaders(input.requestHeaders, this.maskHeaders);
    }
    if (
      opts.captureRequestBody === true &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      input.requestBody != null
    ) {
      entry.requestBody = redact(input.requestBody);
    }
    if (opts.captureResponseHeaders !== false && input.responseHeaders != null) {
      entry.responseHeaders = extractHeaders(input.responseHeaders, this.maskHeaders);
    }
    if (opts.captureResponseBody === true && input.responseBody != null) {
      entry.responseBody = redact(input.responseBody);
    }

    this.record(entry);
  }

  /**
   * Append an already-built entry to the active profile, as-is (no capture
   * flags / masking applied). Prefer {@link capture} unless you have a reason to
   * bypass the options. No-op outside a CLS context or when no profile is active.
   */
  record(entry: HttpRequestEntry): void {
    appendHttpRequestEntry(this.resolveCls(), entry);
  }
}
