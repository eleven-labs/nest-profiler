import type { Review } from './review.js';

/**
 * How the GraphQL layer loads the reviews of a product. The abstract class doubles as the DI token
 * and has two adapters, selected by `FEATURE_DATALOADER`:
 *
 * - `DirectProductReviewsLoader` (default) issues one `find({ productId })` per product — the
 *   MongoDB half of the demo query's N+1;
 * - `DataLoaderProductReviewsLoader` (`FEATURE_DATALOADER=true`) collects the ids of every product
 *   in the result and resolves them with a single `find({ productId: { $in: [...] } })`.
 *
 * Batching here is also what lets {@link ReviewerLoader} batch: when every product's reviews land
 * together, all the author lookups happen in the same tick and collapse into one HTTP call.
 */
export abstract class ProductReviewsLoader {
  abstract load(productId: string): Promise<Review[]>;
}
