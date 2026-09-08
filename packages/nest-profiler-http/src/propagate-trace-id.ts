import { DEFAULT_TRACE_ID_HEADER, readTraceId } from '@eleven-labs/nest-profiler';
import type { ClsService } from 'nestjs-cls';
import type { HttpCaptureOptions } from './http-request.interface';

/**
 * The header an outgoing call should carry the trace id on, or `undefined` when propagation is off.
 *
 * @param option - The module's `propagateTraceId`: `true` for the default header, a string for a
 *   custom one, anything falsy to stay out of the application's outgoing traffic.
 */
export function resolveTraceIdHeader(
  option: HttpCaptureOptions['propagateTraceId'],
): string | undefined {
  if (option === true) return DEFAULT_TRACE_ID_HEADER;
  if (typeof option === 'string' && option.trim()) return option.trim().toLowerCase();
  return undefined;
}

/**
 * The trace id to forward on an outgoing call, or `undefined` when there is nothing to forward.
 *
 * Returns nothing outside a profiled request, which is the normal case for a call made during
 * bootstrap or from a background task — propagation is an aid, never a precondition for the call.
 */
export function outgoingTraceId(
  cls: ClsService | undefined,
  header: string | undefined,
): string | undefined {
  if (!header) return undefined;
  return readTraceId(cls);
}

/**
 * Whether a set of already-present headers carries the propagation header.
 *
 * An explicit value always wins: the caller wrote it on purpose, and overwriting it would break
 * exactly the correlation the caller was setting up. Compared case-insensitively, since header
 * names are.
 */
export function hasHeader(headers: unknown, header: string): boolean {
  if (!headers || typeof headers !== 'object') return false;
  const lower = header.toLowerCase();
  if (typeof (headers as Headers).has === 'function') {
    try {
      return (headers as Headers).has(lower);
    } catch {
      return false;
    }
  }
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}
