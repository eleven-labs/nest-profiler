import { Injectable } from '@nestjs/common';
import type { HttpInstrumentation } from '../http-instrumentation.interface';
import type { HttpProfilerRecorder } from '../http-profiler-recorder.service';

type FetchFn = typeof fetch;
type PatchableFetch = FetchFn & { __profilerPatched?: boolean };

/**
 * Built-in {@link HttpInstrumentation} for the global `fetch` (Node ≥ 22 built-in, undici-backed).
 * It patches `globalThis.fetch` once and records every call on the active profile via
 * {@link HttpProfilerRecorder}. A single global hook covers every caller — no per-instance wiring.
 *
 * Response bodies are read (via `Response.clone()`) only when `captureResponseBody` is enabled, so
 * the default hot path never buffers a payload. Request bodies are captured only for serialisable
 * `init.body` values (string / `URLSearchParams`); streams, `Blob` and `FormData` are skipped to
 * avoid consuming the caller's body.
 */
@Injectable()
export class FetchInstrumentation implements HttpInstrumentation {
  install(recorder: HttpProfilerRecorder): void {
    const globalRef = globalThis as { fetch?: PatchableFetch };
    const original = globalRef.fetch;

    // Soft no-op when fetch is unavailable, and idempotent if already patched.
    if (typeof original !== 'function' || original.__profilerPatched) return;

    const patched: PatchableFetch = async (input, init) => {
      const startedAt = Date.now();
      const method = resolveMethod(input, init);
      const url = resolveUrl(input);
      const requestHeaders = resolveRequestHeaders(input, init);
      const requestBody = serializableRequestBody(init?.body);

      try {
        const response = await original(input, init);
        const responseBody =
          recorder.options.captureResponseBody === true
            ? await safeReadBody(response.clone())
            : undefined;

        recorder.capture({
          method,
          url,
          startedAt,
          duration: Date.now() - startedAt,
          statusCode: response.status,
          requestHeaders,
          requestBody,
          responseHeaders: response.headers,
          responseBody,
        });
        return response;
      } catch (error) {
        recorder.capture({
          method,
          url,
          startedAt,
          duration: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          requestHeaders,
          requestBody,
        });
        throw error;
      }
    };

    patched.__profilerPatched = true;
    globalRef.fetch = patched;
  }
}

function isRequest(input: unknown): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (isRequest(input)) return input.method;
  return 'GET';
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (isRequest(input)) return input.url;
  return String(input);
}

/** Normalises request headers to a `Headers` object (any `HeadersInit` shape) for the recorder. */
function resolveRequestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers | undefined {
  try {
    if (init?.headers) return new Headers(init.headers);
    if (isRequest(input)) return input.headers;
  } catch {
    // Malformed headers — skip rather than throw inside the caller's fetch.
  }
  return undefined;
}

/**
 * Returns a display-friendly view of a request body only when it can be captured without consuming
 * the caller's stream: strings (parsed as JSON when possible) and `URLSearchParams`. Everything
 * else (streams, `Blob`, `FormData`, `ArrayBuffer`) is skipped.
 */
function serializableRequestBody(body: BodyInit | null | undefined): unknown {
  if (body == null) return undefined;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return Object.fromEntries(body);
  }
  return undefined;
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}
