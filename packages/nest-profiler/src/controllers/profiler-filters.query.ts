/**
 * Normalized query params for the profiler list page.
 *
 * Raw HTTP query values arrive as strings; {@link ProfilerFiltersPipe} parses
 * and validates them into this shape (numeric fields become real numbers, with
 * absent or non-numeric values dropped). Keeping the parsing in a dedicated pipe
 * means this package depends on no specific validation library — consumers are
 * free to use class-validator, zod, or nothing at all for their own DTOs.
 */
export class ProfilerFiltersQuery {
  method?: string;
  statusCode?: number;
  minDuration?: number;
  maxDuration?: number;
  url?: string;
}
