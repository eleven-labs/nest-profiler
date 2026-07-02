import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { ProfilingModule } from './profiling/profiling.module.js';
import appConfig, { isProfilerEnabled } from './config/app.config.js';
import featuresConfig from './config/features.config.js';
import { ContentModule } from './content/content.module.js';
import { DiagnosticsModule } from './diagnostics/diagnostics.module.js';

/**
 * Composition root for the CLI (`cli.ts`). It reuses the feature contexts that expose commands —
 * `ContentModule` (`content:sync`) and `DiagnosticsModule` (`demo:greet`) — while avoiding web-only
 * infrastructure (GraphQL, TypeORM, Mongoose). Uses **file** storage so the command profiles it
 * writes show up in the HTTP app's web profiler at `/_profiler`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig, featuresConfig] }),

    CacheModule.register({ isGlobal: true, ttl: 60000 }),

    // Profiler: active bundle (core + commander collector) or the no-op fallback.
    ConditionalModule.registerWhen(ProfilingModule.forCli(), isProfilerEnabled),
    ConditionalModule.registerWhen(
      ProfilerNoopModule.forRoot({ isGlobal: true }),
      (env) => !isProfilerEnabled(env),
    ),

    ContentModule,
    DiagnosticsModule,
  ],
})
export class CliModule {}
