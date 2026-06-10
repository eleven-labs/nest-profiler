import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { CommanderCollectorModule } from '@eleven-labs/nest-profiler-commander';
import appConfig, { isProfilerEnabled } from './config/app.config.js';
import featuresConfig from './config/features.config.js';
import { CommandsModule } from './commands/commands.module.js';

/**
 * Lightweight module bootstrapped by the CLI (`cli.ts`). It deliberately avoids the web-only
 * infrastructure (GraphQL, TypeORM, Mongoose) and uses **file** storage so the command
 * profiles it writes show up in the HTTP app's web profiler at `/_profiler`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig, featuresConfig] }),

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

    CommandsModule,
  ],
})
export class CliModule {}
