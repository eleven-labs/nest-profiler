import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AxiosCollectorModule } from '@eleven-labs/nest-profiler-axios';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';
import { profilerEnabled } from '../config/profiler-enabled';
import { PostsController } from './posts.controller';

@Module({
  imports: [
    HttpModule,
    AxiosCollectorModule.forRoot({
      enabled: profilerEnabled,
      captureResponseBody: true,
    }),
    CacheCollectorModule.forRoot({ enabled: profilerEnabled }),
  ],
  controllers: [PostsController],
})
export class PostsModule {}
