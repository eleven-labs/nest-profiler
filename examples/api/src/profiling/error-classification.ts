import type { ProfilerErrorOptions } from '@eleven-labs/nest-profiler';

/**
 * What counts as a failed request in this app. The default (5xx, so a 404 is an answer rather than
 * an error) is what most apps want; this demo also flags 429 to show that a predicate can pick out
 * individual statuses. Shared so every entrypoint kind built on HTTP classifies the same way.
 */
export const HTTP_ERROR_OPTIONS: ProfilerErrorOptions = {
  httpStatus: (statusCode) => statusCode >= 500 || statusCode === 429,
};
