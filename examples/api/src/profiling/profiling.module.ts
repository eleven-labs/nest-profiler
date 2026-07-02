import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProfilerModule, combineFilters } from '@eleven-labs/nest-profiler';
import {
  ignoreGraphQLPlayground,
  ignoreGraphQLIntrospection,
} from '@eleven-labs/nest-profiler-graphql';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';
import { CommanderCollectorModule } from '@eleven-labs/nest-profiler-commander';

/**
 * Bundles the profiler modules that belong at the composition root — the core `ProfilerModule` plus
 * the global collectors (config, validator, commander) — into a single module. It carries **no**
 * `ConditionalModule` itself: the composition root gates the whole bundle with one
 * `ConditionalModule.registerWhen(ProfilingModule.forWeb(), isProfilerEnabled)` and pairs it with
 * `ProfilerNoopModule` for the off state — so the root keeps just two profiler-related entries.
 *
 * Infra-scoped collectors (http, cache, database, rabbitmq, graphql transport) stay co-located in
 * the bounded-context modules that own their infrastructure — they are gated by their own feature
 * flags (`SQL_ORM`, `FEATURE_MONGOOSE`…) on top of the profiler flag, so they cannot be hoisted here.
 */
@Module({})
export class ProfilingModule {
  /** Web app bundle: core profiler + config, validator and commander collectors. */
  static forWeb(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRootAsync({
          isGlobal: true,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const storageType = config.get<'memory' | 'file'>('app.profilerStorageType');
            return {
              storageType,
              ...(storageType === 'file' && {
                storagePath: config.get<string>('app.profilerStoragePath'),
                ttl: config.get<number>('app.profilerTtl'),
              }),
              maxProfiles: config.get<number>('app.profilerMaxProfiles'),
              collectBody: true,
              sampleRate: 1.0,
              ignorePaths: ['/favicon.ico'],
              ignoreRequest: combineFilters(ignoreGraphQLPlayground, ignoreGraphQLIntrospection),
            };
          },
        }),
        ConfigCollectorModule.forRoot({ maskKeys: ['database.password'] }),
        ValidatorCollectorModule.forRoot({
          validationPipeOptions: { whitelist: true, transform: true },
        }),
        CommanderCollectorModule.forRoot(),
      ],
    };
  }

  /** CLI bundle: core profiler (file storage by default) + the commander collector. */
  static forCli(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRootAsync({
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
        CommanderCollectorModule.forRoot(),
      ],
    };
  }
}
