import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type {
  HttpCaptureInput,
  HttpCaptureOptions,
  HttpRequestEntry,
} from './http-request.interface';
import { appendHttpRequestEntry } from './append-http-request-entry.util';
import { DEFAULT_MASK_HEADERS, extractHeaders } from './http-redaction.util';
import { HTTP_COLLECTOR_OPTIONS } from './http-collector.constants';

/**
 * Injectable façade for recording outgoing HTTP requests into the active
 * profile. This is the API to reach for from application code or a custom
 * instrumentation: inject it and call {@link capture} with the raw
 * request/response material — it applies the configured capture flags and
 * header masking for you. The bundled axios adapter uses it too.
 */
@Injectable()
export class HttpProfilerRecorder {
  /** Built-in mask list merged with the configured `maskHeaders`. */
  readonly maskHeaders: string[];

  constructor(
    private readonly cls: ClsService,
    @Inject(HTTP_COLLECTOR_OPTIONS) readonly options: HttpCaptureOptions,
  ) {
    this.maskHeaders = [...DEFAULT_MASK_HEADERS, ...(options.maskHeaders ?? [])];
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
      url: input.url,
      statusCode: input.statusCode,
      duration: input.duration,
      startedAt: input.startedAt,
      error: input.error,
    };

    if (opts.captureRequestHeaders !== false && input.requestHeaders != null) {
      entry.requestHeaders = extractHeaders(input.requestHeaders, this.maskHeaders);
    }
    if (
      opts.captureRequestBody !== false &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      input.requestBody != null
    ) {
      entry.requestBody = input.requestBody;
    }
    if (opts.captureResponseHeaders !== false && input.responseHeaders != null) {
      entry.responseHeaders = extractHeaders(input.responseHeaders, this.maskHeaders);
    }
    if (opts.captureResponseBody === true && input.responseBody != null) {
      entry.responseBody = input.responseBody;
    }

    this.record(entry);
  }

  /**
   * Append an already-built entry to the active profile, as-is (no capture
   * flags / masking applied). Prefer {@link capture} unless you have a reason to
   * bypass the options. No-op outside a CLS context or when no profile is active.
   */
  record(entry: HttpRequestEntry): void {
    appendHttpRequestEntry(this.cls, entry);
  }
}
