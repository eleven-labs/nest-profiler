import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import mongodbConfig from '../config/mongodb.config';
import { ReviewsModule } from '../reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forFeature(mongodbConfig),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodb.uri'),
      }),
    }),
    ReviewsModule,
  ],
})
export class MongoModule {}
