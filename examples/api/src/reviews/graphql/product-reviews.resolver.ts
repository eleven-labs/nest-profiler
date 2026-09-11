import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ProductType } from '../../catalog/graphql/product.type.js';
import { ProductReviewsLoader } from '../domain/product-reviews-loader.js';
import { ReviewType } from './review.type.js';
import type { Review } from '../domain/review.js';

/**
 * Cross-context GraphQL bridge: extends the catalog's `Product` type with a `reviews` field backed by
 * the reviews (Mongoose) context. Because it is declared in `ReviewsModule`, it is only registered —
 * and the `reviews` field only appears in the schema — when `FEATURE_MONGOOSE=true`; the auto-schema
 * scan then picks it up whenever GraphQL is on.
 *
 * Resolving a product's reviews reads MongoDB, so a single GraphQL request that lists products
 * touches both the SQL ORM (catalog) and MongoDB (reviews) — the profiler's Database panel then
 * shows both collectors side by side. How the query is issued is the {@link ProductReviewsLoader}'s
 * business: one `find({ productId })` per product by default, or a single
 * `find({ productId: { $in: [...] } })` when `FEATURE_DATALOADER=true`.
 */
@Resolver(() => ProductType)
export class ProductReviewsResolver {
  constructor(private readonly loader: ProductReviewsLoader) {}

  @ResolveField(() => [ReviewType], { description: 'Reviews for this product (from MongoDB)' })
  reviews(@Parent() product: ProductType): Promise<Review[]> {
    return this.loader.load(String(product.id));
  }
}
