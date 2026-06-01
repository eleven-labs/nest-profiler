import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';
import { AppController } from './app.controller';
import { profilerEnabled } from './config/profiler-enabled';
import { ProductsModule } from './products/products.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './posts/posts.module';
import { Product } from './products/product.entity';
import databaseConfig from './config/database.config';
import mongodbConfig from './config/mongodb.config';
import appConfig from './config/app.config';

@Module({
  imports: [
    // Core — load factories populate ConfigService.internalConfig (required by ConfigCollector)
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, mongodbConfig, appConfig],
    }),

    // TypeORM — reads from the database config factory
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        entities: [Product],
        synchronize: config.get<string>('app.env') !== 'production',
        logging: false,
      }),
    }),

    // Mongoose — reads from the mongodb config factory
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodb.uri'),
      }),
    }),

    // Global cache — consumed by PostsModule and any other module that needs caching
    CacheModule.register({ isGlobal: true, ttl: 30000 }),

    // Profiler core — the host app owns the dev/prod decision (profilerEnabled),
    // forwarded as `enabled` to every profiler module. When false, only the
    // inert ProfilerService is registered (no middleware/interceptor/controller).
    ProfilerModule.forRoot({
      enabled: profilerEnabled,
      isGlobal: true,
      storageType: 'file',
      storagePath: '.profiler',
      maxProfiles: 200,
      collectBody: true,
      sampleRate: 1.0,
      ignorePaths: ['/favicon.ico'],
    }),

    // Global profiler collectors (not tied to a single feature module)
    ConfigCollectorModule.forRoot({ enabled: profilerEnabled, maskKeys: ['database.password'] }),
    // ValidatorCollectorModule installs ProfilerValidationPipe as global APP_PIPE
    ValidatorCollectorModule.forRoot({
      enabled: profilerEnabled,
      whitelist: true,
      transform: true,
    }),

    // Feature modules — each registers its own collector
    ProductsModule,
    ReviewsModule,
    AuthModule,
    PostsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
