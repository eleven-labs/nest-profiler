import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { isRabbitMqEnabled } from '../config/features.config.js';
import { not } from '../config/env-condition.js';
import { ReviewController } from './http/review.controller.js';
import { ReviewService } from './application/review.service.js';
import { ProductReviewsResolver } from './graphql/product-reviews.resolver.js';
import { ReviewMongooseModule } from './infrastructure/mongoose/review.mongoose.module.js';
import { NotificationsRabbitMqModule } from '../notifications/infrastructure/rabbitmq/notifications.rabbitmq.module.js';
import { NotificationsNoopModule } from '../notifications/infrastructure/noop/notifications.noop.module.js';

/**
 * Reviews bounded context. Owns the HTTP + application layers, which depend only on the
 * {@link ReviewRepository} port (bound by the Mongoose adapter) and the {@link EventPublisher} port.
 * Exactly one messaging adapter provides the port: the RabbitMQ adapter when `FEATURE_RABBITMQ=true`
 * (which also runs the `review.created` consumer), or the no-op adapter otherwise. Loaded by
 * `AppModule` only when `FEATURE_MONGOOSE=true`.
 *
 * `ProductReviewsResolver` bridges this context into the catalog's GraphQL `Product` type: since it
 * lives here, the `Product.reviews` field only exists when Mongoose is on, and the GraphQL scan wires
 * it whenever GraphQL is also on — a single `products` query then hits both the SQL ORM and MongoDB.
 * It stays a harmless unused provider when GraphQL is off.
 */
@Module({
  imports: [
    ReviewMongooseModule,
    ConditionalModule.registerWhen(NotificationsRabbitMqModule, isRabbitMqEnabled),
    ConditionalModule.registerWhen(NotificationsNoopModule, not(isRabbitMqEnabled)),
  ],
  controllers: [ReviewController],
  providers: [ReviewService, ProductReviewsResolver],
})
export class ReviewsModule {}
