import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { CommanderCollectorModule } from '@eleven-labs/nest-profiler-commander';
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

    ProfilerModule.forRootAsync({
      enabled: isProfilerEnabled(process.env),
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const storageType = config.get<'memory' | 'file'>('app.profilerStorageType') ?? 'file';
        return {
          storageType,
          ...(storageType === 'file' && {
            storagePath: config.get<string>('app.profilerStoragePath'),
            ttl: config.get<number>('app.profilerTtl'),
          }),
          maxProfiles: config.get<number>('app.profilerMaxProfiles'),
        };
      },
    }),

    CommanderCollectorModule.forRoot({ enabled: isProfilerEnabled(process.env) }),

    ContentModule,
    DiagnosticsModule,
  ],
})
export class CliModule {}
