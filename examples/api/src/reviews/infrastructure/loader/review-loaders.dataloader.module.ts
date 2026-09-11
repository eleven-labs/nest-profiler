import { Module } from '@nestjs/common';
import { ProductReviewsLoader } from '../../domain/product-reviews-loader.js';
import { ReviewerLoader } from '../../domain/reviewer-loader.js';
import { ReviewApplicationModule } from '../../application/review.application.module.js';
import { reviewerGatewayImports } from '../http/reviewer-gateway.imports.js';
import {
  DataLoaderProductReviewsLoader,
  DataLoaderReviewerLoader,
} from './review-loaders.dataloader.js';

/**
 * Batched loading strategy — selected when `FEATURE_DATALOADER=true`. Sole provider/exporter of both
 * loader ports; the bindings keep the adapters' request scope, which is what gives each request its
 * own DataLoader cache. Batching the reviews is what allows the authors to be batched too, so the
 * whole demo query ends up with one MongoDB query and one outgoing HTTP call.
 */
@Module({
  imports: [ReviewApplicationModule, ...reviewerGatewayImports()],
  providers: [
    { provide: ProductReviewsLoader, useClass: DataLoaderProductReviewsLoader },
    { provide: ReviewerLoader, useClass: DataLoaderReviewerLoader },
  ],
  exports: [ProductReviewsLoader, ReviewerLoader],
})
export class ReviewLoadersDataLoaderModule {}
