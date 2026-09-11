import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { isRabbitMqEnabled } from '../../config/features.config.js';
import { not } from '../../config/env-condition.js';
import { ReviewMongooseModule } from '../infrastructure/mongoose/review.mongoose.module.js';
import { NotificationsRabbitMqModule } from '../../notifications/infrastructure/rabbitmq/notifications.rabbitmq.module.js';
import { NotificationsEventEmitterModule } from '../../notifications/infrastructure/event-emitter/notifications.event-emitter.module.js';
import { ReviewService } from './review.service.js';

/**
 * Application layer of the reviews context, in its own module because both the REST entrypoint
 * (`ReviewsModule`) and the GraphQL loader adapters depend on it — the profiler spans (`db.reviews.*`)
 * are therefore declared once and shared by every entrypoint, exactly like `ProductService` in the
 * catalog.
 *
 * It owns the two ports {@link ReviewService} needs: the {@link ReviewRepository} (Mongoose adapter)
 * and the {@link EventPublisher} — the RabbitMQ adapter when `FEATURE_RABBITMQ=true` (which also runs
 * the `review.created` consumer), or the in-process `@nestjs/event-emitter` adapter otherwise, so
 * `review.created` is published and handled with no broker.
 */
@Module({
  imports: [
    ReviewMongooseModule,
    ConditionalModule.registerWhen(NotificationsRabbitMqModule, isRabbitMqEnabled),
    ConditionalModule.registerWhen(NotificationsEventEmitterModule, not(isRabbitMqEnabled)),
  ],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewApplicationModule {}
