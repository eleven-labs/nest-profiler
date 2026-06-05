import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseCollectorModule } from '@eleven-labs/nest-profiler-mongoose';
import { isProfilerEnabled } from '../config/app.config.js';
import { Review, ReviewSchema } from './review.schema.js';
import { ReviewsService } from './reviews.service.js';
import { ReviewsController } from './reviews.controller.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
    MongooseCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      slowQueryThreshold: 50,
    }),
  ],
  providers: [ReviewsService],
  controllers: [ReviewsController],
})
export class ReviewsModule {}
