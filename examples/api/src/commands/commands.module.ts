import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';
import { isProfilerEnabled } from '../config/app.config.js';
import { SyncPostsCommand } from './sync-posts.command.js';
import { GreetCommand } from './greet.command.js';

/**
 * Demo CLI commands. The HTTP + cache collectors are imported here so a single command run
 * surfaces the **Command**, **HTTP Client**, and **Cache** panels in the profiler.
 */
@Module({
  imports: [
    HttpModule,
    HttpCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      captureResponseBody: true,
    }),
    CacheModule.register({ isGlobal: true, ttl: 60000 }),
    CacheCollectorModule.forRoot({ enabled: isProfilerEnabled(process.env) }),
  ],
  providers: [SyncPostsCommand, GreetCommand],
})
export class CommandsModule {}
