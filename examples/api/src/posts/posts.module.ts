import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';
import { isProfilerEnabled } from '../config/app.config.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';
import { PostsFetchService } from './posts-fetch.service.js';

@Module({
  imports: [
    HttpModule,
    HttpCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      captureResponseBody: true,
    }),
    CacheCollectorModule.forRoot({ enabled: isProfilerEnabled(process.env) }),
  ],
  controllers: [PostsController],
  providers: [PostsService, PostsFetchService],
})
export class PostsModule {}
