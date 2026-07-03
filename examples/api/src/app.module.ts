import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { LoggerModule } from 'nestjs-pino';
import { ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { ProfilingModule } from './profiling/profiling.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { ContentModule } from './content/content.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { DiagnosticsModule } from './diagnostics/diagnostics.module.js';
import appConfig from './config/app.config.js';
import profilerConfig, { isProfilerEnabled } from './config/profiler.config.js';
import featuresConfig, {
  isMongooseEnabled,
  isPinoLoggerEnabled,
} from './config/features.config.js';
import { not } from './config/env-condition.js';

/**
 * Composition root. Holds only cross-cutting infrastructure (`forRoot`/global registrations) and
 * imports the feature (bounded-context) modules — no controller and no other module lives at the
 * root. Contexts that need no infrastructure are always loaded (catalog on its in-memory adapter,
 * content, auth, health, diagnostics, notifications with a no-op publisher), so the app boots with
 * zero DB/broker. GraphQL and RabbitMQ are gated inside their own contexts; only Mongoose-backed
 * reviews and the pino logger are gated here.
 *
 * The profiler is toggled the recommended way: `ConditionalModule.registerWhen` loads the active
 * `ProfilerModule` when `PROFILER_ENABLED` is on, and `ProfilerNoopModule` otherwise — so
 * `ProfilerService` stays injectable everywhere even when profiling is off. The `enabled` option
 * (still supported by every profiler module) is the alternative.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, profilerConfig, featuresConfig],
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

    // Profiler: one gate loads the whole active bundle (core + global collectors), the other the
    // zero-cost no-op fallback so ProfilerService stays injectable when profiling is off.
    ConditionalModule.registerWhen(ProfilingModule.forWeb(), isProfilerEnabled),
    ConditionalModule.registerWhen(
      ProfilerNoopModule.forRoot({ isGlobal: true }),
      not(isProfilerEnabled),
    ),

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
