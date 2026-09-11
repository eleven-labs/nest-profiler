import { Module } from '@nestjs/common';
import { ProductReviewsLoader } from '../../domain/product-reviews-loader.js';
import { ReviewerLoader } from '../../domain/reviewer-loader.js';
import { ReviewApplicationModule } from '../../application/review.application.module.js';
import { reviewerGatewayImports } from '../http/reviewer-gateway.imports.js';
import { DirectProductReviewsLoader, DirectReviewerLoader } from './review-loaders.direct.js';

/**
 * Default loading strategy behind the GraphQL `Product.reviews` / `Review.author` fields: one query
 * per product, one HTTP call per author. Sole provider/exporter of both loader ports; loaded by
 * `ReviewsModule` when `FEATURE_DATALOADER` is off.
 */
@Module({
  imports: [ReviewApplicationModule, ...reviewerGatewayImports()],
  providers: [
    { provide: ProductReviewsLoader, useClass: DirectProductReviewsLoader },
    { provide: ReviewerLoader, useClass: DirectReviewerLoader },
  ],
  exports: [ProductReviewsLoader, ReviewerLoader],
})
export class ReviewLoadersDirectModule {}
