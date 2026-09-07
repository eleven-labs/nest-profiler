/**
 * Redaction helpers now live in the core package so the middleware, the HTTP client
 * instrumentations and RabbitMQ all share one implementation. Re-exported here for backwards
 * compatibility with existing deep imports within this package.
 */
import { buildMaskedQueryParams, DEFAULT_MASK_QUERY_PARAMS } from '@eleven-labs/nest-profiler';
import type { HttpCaptureOptions } from './http-request.interface';

export {
  DEFAULT_MASK_HEADERS,
  extractHeaders,
  formatHeaderValue,
} from '@eleven-labs/nest-profiler';
export { DEFAULT_MASK_QUERY_PARAMS, redactQueryString } from '@eleven-labs/nest-profiler';

/**
 * Resolves the query parameters whose values are masked in a recorded URL: the built-in list
 * (unless opted out of) plus whatever the collector was configured with.
 *
 * Additive by default, and sharing the core's list rather than keeping its own — an outgoing
 * `?token=` is exactly as sensitive as an incoming one, and two lists that drift apart mean one
 * of the two paths quietly stops protecting something.
 */
export function resolveMaskedQueryParams(options: HttpCaptureOptions): ReadonlySet<string> {
  return buildMaskedQueryParams([
    ...(options.useDefaultMaskQueryParams === false ? [] : DEFAULT_MASK_QUERY_PARAMS),
    ...(options.maskQueryParams ?? []),
  ]);
}
