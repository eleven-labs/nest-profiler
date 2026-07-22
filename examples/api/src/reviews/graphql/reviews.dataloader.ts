import DataLoader from 'dataloader';
import { ReviewService } from '../application/review.service.js';
import type { Review } from '../domain/review.js';

/**
 * Per-request DataLoader for `Product.reviews`. Every `load(productId)` call within a single tick is
 * coalesced into one {@link ReviewService.findByProducts} batch, so a `products` query resolves all
 * products' reviews with a single `reviews.find({ productId: $in })` instead of one query per product.
 *
 * Constructed fresh per request by a `Scope.REQUEST` factory (see `ReviewsModule`) so its cache never
 * leaks across requests. In the profiler's trace this collapses the N `db.reviews.findByProduct`
 * spans into one `db.reviews.findByProducts` batch.
 */
export class ReviewsDataLoader {
  private readonly loader: DataLoader<string, Review[]>;

  constructor(reviewService: ReviewService) {
    this.loader = new DataLoader<string, Review[]>(async (productIds) => {
      const grouped = await reviewService.findByProducts([...productIds]);
      return productIds.map((id) => grouped.get(id) ?? []);
    });
  }

  load(productId: string): Promise<Review[]> {
    return this.loader.load(productId);
  }
}
