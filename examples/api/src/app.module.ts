import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ProfilerModule, combineFilters } from '@eleven-labs/nest-profiler';
import {
  ignoreGraphQLPlayground,
  ignoreGraphQLIntrospection,
} from '@eleven-labs/nest-profiler-graphql';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { MongoModule } from './mongo/mongo.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './posts/posts.module';
import { AppGraphQLModule } from './graphql.module';
import appConfig, { isProfilerEnabled } from './config/app.config';
import featuresConfig, {
  isTypeOrmEnabled,
  isMongooseEnabled,
  isGraphQLEnabled,
} from './config/features.config';

@Module({
  imports: [
    // Core — load factories populate ConfigService.internalConfig (required by ConfigCollector)
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, featuresConfig],
    }),

    // TypeORM + ProductsModule — disabled when FEATURE_TYPEORM=false
    ConditionalModule.registerWhen(DatabaseModule, isTypeOrmEnabled),

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
    // ValidatorCollectorModule installs ProfilerValidationPipe as global APP_PIPE
    ValidatorCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      whitelist: true,
      transform: true,
    }),

    // Feature modules — no infra dependency
    AuthModule,
    PostsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
