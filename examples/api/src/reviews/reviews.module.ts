import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { isDataloaderEnabled } from '../config/features.config.js';
import { not } from '../config/env-condition.js';
import { ReviewController } from './http/review.controller.js';
import { ReviewApplicationModule } from './application/review.application.module.js';
import { ProductReviewsResolver } from './graphql/product-reviews.resolver.js';
import { ReviewAuthorResolver } from './graphql/review-author.resolver.js';
import { ReviewLoadersDirectModule } from './infrastructure/loader/review-loaders.direct.module.js';
import { ReviewLoadersDataLoaderModule } from './infrastructure/loader/review-loaders.dataloader.module.js';

/**
 * Reviews bounded context. The HTTP entrypoint reads through {@link ReviewApplicationModule}, which
 * owns `ReviewService` and the two ports it depends on — the {@link ReviewRepository} (Mongoose) and
 * the {@link EventPublisher} (RabbitMQ or in-process). Loaded by `AppModule` only when
 * `FEATURE_MONGOOSE=true`.
 *
 * `ProductReviewsResolver` bridges this context into the catalog's GraphQL `Product` type: since it
 * lives here, the `Product.reviews` field only exists when Mongoose is on, and the GraphQL scan wires
 * it whenever GraphQL is also on — a single `products` query then hits both the SQL ORM and MongoDB.
 * `ReviewAuthorResolver` adds the third source to that same query: a review stores only its author's
 * id, and the field resolver fetches the profile from an external user directory over HTTP. Both
 * resolvers read through a loader port rather than calling MongoDB/HTTP themselves, and
 * `FEATURE_DATALOADER` picks the adapters: one query per product plus one call per author (default,
 * an observable N+1 on both sides), or a single `$in` query plus a single bulk HTTP call. They stay
 * harmless unused providers when GraphQL is off.
 */
@Module({
  imports: [
    ReviewApplicationModule,
    ConditionalModule.registerWhen(ReviewLoadersDataLoaderModule, isDataloaderEnabled),
    ConditionalModule.registerWhen(ReviewLoadersDirectModule, not(isDataloaderEnabled)),
  ],
  controllers: [ReviewController],
  providers: [ProductReviewsResolver, ReviewAuthorResolver],
})
export class ReviewsModule {}
