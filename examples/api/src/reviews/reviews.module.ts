import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { isRabbitMqEnabled } from '../config/features.config.js';
import { ReviewController } from './http/review.controller.js';
import { ReviewService } from './application/review.service.js';
import { ReviewMongooseModule } from './infrastructure/mongoose/review.mongoose.module.js';
import { NotificationsRabbitMqModule } from '../notifications/infrastructure/rabbitmq/notifications.rabbitmq.module.js';
import { NotificationsNoopModule } from '../notifications/infrastructure/noop/notifications.noop.module.js';

/**
 * Reviews bounded context. Owns the HTTP + application layers, which depend only on the
 * {@link ReviewRepository} port (bound by the Mongoose adapter) and the {@link EventPublisher} port.
 * Exactly one messaging adapter provides the port: the RabbitMQ adapter when `FEATURE_RABBITMQ=true`
 * (which also runs the `review.created` consumer), or the no-op adapter otherwise. Loaded by
 * `AppModule` only when `FEATURE_MONGOOSE=true`.
 */
@Module({
  imports: [
    ReviewMongooseModule,
    ConditionalModule.registerWhen(NotificationsRabbitMqModule, isRabbitMqEnabled),
    ConditionalModule.registerWhen(NotificationsNoopModule, (env) => !isRabbitMqEnabled(env)),
  ],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewsModule {}
