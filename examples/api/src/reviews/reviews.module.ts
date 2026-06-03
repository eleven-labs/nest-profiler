import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseCollectorModule } from '@eleven-labs/nest-profiler-mongoose';
import { isProfilerEnabled } from '../config/app.config';
import { Review, ReviewSchema } from './review.schema';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';

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
