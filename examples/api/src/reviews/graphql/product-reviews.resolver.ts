import { Optional } from '@nestjs/common';
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ProductType } from '../../catalog/graphql/product.type.js';
import { ReviewService } from '../application/review.service.js';
import { ReviewsDataLoader } from './reviews.dataloader.js';
import { ReviewType } from './review.type.js';
import type { Review } from '../domain/review.js';

/**
 * Cross-context GraphQL bridge: extends the catalog's `Product` type with a `reviews` field backed by
 * the reviews (Mongoose) context. Because it is declared in `ReviewsModule`, it is only registered —
 * and the `reviews` field only appears in the schema — when `FEATURE_MONGOOSE=true`; the auto-schema
 * scan then picks it up whenever GraphQL is on.
 *
 * By default it resolves per product, issuing one `db.reviews.find({ productId })` per product — the
 * N+1 shape the profiler's trace makes obvious. With `FEATURE_DATALOADER=true` a per-request
 * {@link ReviewsDataLoader} is provided and used instead, batching all products into a single
 * `db.reviews.findByProducts` query — the trace then shows the batched shape for comparison.
 */
@Resolver(() => ProductType)
export class ProductReviewsResolver {
  constructor(
    private readonly reviewService: ReviewService,
    // Present only when FEATURE_DATALOADER is on (the factory yields undefined otherwise).
    @Optional() private readonly loader?: ReviewsDataLoader,
  ) {}

  @ResolveField(() => [ReviewType], { description: 'Reviews for this product (from MongoDB)' })
  reviews(@Parent() product: ProductType): Promise<Review[]> {
    const productId = String(product.id);
    return this.loader ? this.loader.load(productId) : this.reviewService.findByProduct(productId);
  }
}
