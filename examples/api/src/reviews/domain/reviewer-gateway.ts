import type { Reviewer } from './reviewer.js';

/**
 * Outbound port to the external user directory that owns the review authors. The abstract class
 * doubles as the DI token; the infrastructure layer binds it to one of two interchangeable adapters
 * — axios or native `fetch`, selected by `HTTP_CLIENT` exactly like the content context — so the
 * reviews context never depends on an HTTP client.
 *
 * Both read shapes are part of the port on purpose: they are the two ways a GraphQL server resolves
 * the same field, and {@link ReviewerLoader} picks between them.
 */
export abstract class ReviewerGateway {
  /** One author, one request (`GET /users/:id`) — the N+1 path. */
  abstract fetchReviewer(id: number): Promise<Reviewer | null>;
  /** Every author in one request (`GET /users?id=1&id=2&…`) — the batched path. */
  abstract fetchReviewers(ids: readonly number[]): Promise<Reviewer[]>;
}
