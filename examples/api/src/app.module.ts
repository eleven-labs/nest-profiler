import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { LoggerModule } from 'nestjs-pino';
import { ProfilerModule, combineFilters } from '@eleven-labs/nest-profiler';
import {
  ignoreGraphQLPlayground,
  ignoreGraphQLIntrospection,
} from '@eleven-labs/nest-profiler-graphql';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';
import { AppController } from './app.controller.js';
import { ProductModule } from './products/product.module.js';
import { MongoModule } from './mongo/mongo.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PostsModule } from './posts/posts.module.js';
import { AppGraphQLModule } from './graphql.module.js';
import appConfig, { isProfilerEnabled } from './config/app.config.js';
import featuresConfig, {
  isMongooseEnabled,
  isGraphQLEnabled,
  isPinoLoggerEnabled,
  isSqlOrmEnabled,
} from './config/features.config.js';

@Module({
  imports: [
    // Core — load factories populate ConfigService.internalConfig (required by ConfigCollector)
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, featuresConfig],
    }),

    // Pino logger — opt-in via FEATURE_PINO_LOGGER=true; wrapped in main.ts with profilerService.createLogger.
    ConditionalModule.registerWhen(
      LoggerModule.forRoot({
        pinoHttp: {
          // LOG_LEVEL overrides (e.g. `silent` in e2e tests — profiler log capture is unaffected).
          level:
            process.env['LOG_LEVEL'] ??
            (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug'),
        },
      }),
      isPinoLoggerEnabled,
    ),

    // Product context — owns the controller/service and selects one SQL ORM adapter internally
    // based on SQL_ORM. Skipped entirely when SQL_ORM=none.
    ConditionalModule.registerWhen(ProductModule, isSqlOrmEnabled),

    // Mongoose + ReviewsModule — disabled when FEATURE_MONGOOSE=false
    ConditionalModule.registerWhen(MongoModule, isMongooseEnabled),

    // GraphQL + BooksModule — disabled when FEATURE_GRAPHQL=false
    ConditionalModule.registerWhen(AppGraphQLModule, isGraphQLEnabled),

    // Global cache — consumed by PostsModule and any other module that needs caching
    CacheModule.register({ isGlobal: true, ttl: 30000 }),

    // Profiler core — enabled/isGlobal are synchronous top-level flags;
    // storage options are resolved via ConfigService once the DI container is ready.
    ProfilerModule.forRootAsync({
      enabled: isProfilerEnabled(process.env),
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

    // Global profiler collectors (not tied to a single feature module)
    ConfigCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      maskKeys: ['database.password'],
    }),
    // ValidatorCollectorModule installs ProfilerValidationPipe as global APP_PIPE.
    // Validator-agnostic: omitting `pipe` wraps a default class-validator pipe built
    // from `validationPipeOptions`. To use nestjs-zod instead, pass `pipe: new ZodValidationPipe()`.
    ValidatorCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      validationPipeOptions: { whitelist: true, transform: true },
    }),

    // Feature modules — no infra dependency
    AuthModule,
    PostsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
