import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseCollectorModule } from '@eleven-labs/nest-profiler-mongoose';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import mongodbConfig from '../../../config/mongodb.config.js';
import { ReviewRepository } from '../../domain/review.repository.js';
import { Review, ReviewSchema } from './review.schema.js';
import { MongooseReviewRepository } from './review.mongoose.repository.js';

/**
 * Mongoose adapter for the reviews context. Owns the MongoDB connection + the Mongoose profiler
 * collector, and is the sole provider/exporter of the {@link ReviewRepository} port. Loaded by
 * `ReviewsModule` only when `FEATURE_MONGOOSE=true`.
 */
@Module({
  imports: [
    ConfigModule.forFeature(mongodbConfig),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ uri: config.get<string>('mongodb.uri') }),
    }),
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
    ConditionalModule.registerWhen(
      MongooseCollectorModule.forRoot({ slowThreshold: 50 }),
      isProfilerEnabled,
    ),
  ],
  providers: [{ provide: ReviewRepository, useClass: MongooseReviewRepository }],
  exports: [ReviewRepository],
})
export class ReviewMongooseModule {}
