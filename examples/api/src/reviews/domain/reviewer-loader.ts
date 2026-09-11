import type { Reviewer } from './reviewer.js';

/**
 * How the GraphQL layer loads a review's author. The abstract class doubles as the DI token and has
 * two adapters, selected by `FEATURE_DATALOADER`:
 *
 * - `DirectReviewerLoader` (default) issues one `GET /users/:id` per review — the textbook GraphQL
 *   N+1, which the profiler tags `n-plus-one` in the HTTP Client panel;
 * - `DataLoaderReviewerLoader` (`FEATURE_DATALOADER=true`) collects the ids requested in the same
 *   tick and resolves them with a single `GET /users?id=…` call.
 *
 * Same query, same response, one HTTP call instead of N: the flag exists so the two waterfalls can
 * be compared side by side in `/_profiler`.
 */
export abstract class ReviewerLoader {
  abstract load(id: number): Promise<Reviewer | null>;
}
