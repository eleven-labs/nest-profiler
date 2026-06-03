import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AxiosCollectorModule } from '@eleven-labs/nest-profiler-axios';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';
import { isProfilerEnabled } from '../config/app.config';
import { PostsController } from './posts.controller';

@Module({
  imports: [
    HttpModule,
    AxiosCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      captureResponseBody: true,
    }),
    CacheCollectorModule.forRoot({ enabled: isProfilerEnabled(process.env) }),
  ],
  controllers: [PostsController],
})
export class PostsModule {}
