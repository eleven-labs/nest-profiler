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
import { CommanderCollectorModule } from '@eleven-labs/nest-profiler-commander';
import { CatalogModule } from './catalog/catalog.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { ContentModule } from './content/content.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { DiagnosticsModule } from './diagnostics/diagnostics.module.js';
import appConfig, { isProfilerEnabled } from './config/app.config.js';
import featuresConfig, {
  isMongooseEnabled,
  isPinoLoggerEnabled,
} from './config/features.config.js';

/**
 * Composition root. Holds only cross-cutting infrastructure (`forRoot`/global registrations) and
 * imports the feature (bounded-context) modules — no controller and no other module lives at the
 * root. Contexts that need no infrastructure are always loaded (catalog on its in-memory adapter,
 * content, auth, health, diagnostics, notifications with a no-op publisher), so the app boots with
 * zero DB/broker. GraphQL and RabbitMQ are gated inside their own contexts; only Mongoose-backed
 * reviews and the pino logger are gated here.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, featuresConfig],
    }),

    ConditionalModule.registerWhen(
      LoggerModule.forRoot({
        pinoHttp: {
          level:
            process.env['LOG_LEVEL'] ??
            (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug'),
          transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
        },
      }),
      isPinoLoggerEnabled,
    ),

    CacheModule.register({ isGlobal: true, ttl: 30000 }),

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

    ConfigCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      maskKeys: ['database.password'],
    }),
    ValidatorCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      validationPipeOptions: { whitelist: true, transform: true },
    }),
    CommanderCollectorModule.forRoot({ enabled: isProfilerEnabled(process.env) }),

    // Feature (bounded-context) modules.
    CatalogModule,
    ContentModule,
    AuthModule,
    HealthModule,
    DiagnosticsModule,
    ConditionalModule.registerWhen(ReviewsModule, isMongooseEnabled),
  ],
})
export class AppModule {}
