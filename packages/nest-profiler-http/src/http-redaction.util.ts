/**
 * Header redaction helpers now live in the core package so the middleware, the HTTP client
 * instrumentations and RabbitMQ all share one implementation. Re-exported here for backwards
 * compatibility with existing deep imports within this package.
 */
export {
  DEFAULT_MASK_HEADERS,
  extractHeaders,
  formatHeaderValue,
} from '@eleven-labs/nest-profiler';
