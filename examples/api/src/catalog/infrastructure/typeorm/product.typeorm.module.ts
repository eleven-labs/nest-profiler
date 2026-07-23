import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  TypeOrmCollectorModule,
  TypeOrmSchemaCollectorModule,
} from '@eleven-labs/nest-profiler-typeorm';
import databaseConfig from '../../../config/database.config.js';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import { ProductRepository } from '../../domain/product.repository.js';
import { ProductEntity } from './product.typeorm.entity.js';
import { TypeOrmProductRepository } from './product.typeorm.repository.js';

/**
 * TypeORM adapter for the products context. Selected when `SQL_ORM=typeorm`. Its only role is to
 * wire the Postgres connection + the TypeORM profiler collector and provide/export the
 * {@link ProductRepository} port — the controller/service live in `ProductModule`.
 */
@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        ssl: config.get<boolean>('database.ssl') ? true : undefined,
        entities: [ProductEntity],
        // Schema management is config-driven (see database.config.ts): outside production it
        // creates + drops-and-recreates the shared `products` table so switching SQL_ORM starts
        // clean; a hosted deploy sets DATABASE_SYNCHRONIZE=true to create the schema without the drop.
        synchronize: config.get<boolean>('database.synchronize'),
        dropSchema: config.get<boolean>('database.dropSchema'),
        logging: false,
      }),
    }),
    TypeOrmModule.forFeature([ProductEntity]),
    // `forRootAsync` drives `slowThreshold` from `ConfigService`; gating stays ConditionalModule's job.
    ConditionalModule.registerWhen(
      TypeOrmCollectorModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          slowThreshold: config.get<number>('profiler.performance.slowThreshold'),
          nPlusOneThreshold: config.get<number>('profiler.performance.nPlusOneThreshold'),
          chattyThreshold: config.get<number>('profiler.performance.chattyThreshold'),
          // Severity is configurable per collector, alongside the thresholds.
          slowSeverity: config.get<'info' | 'warning' | 'danger'>(
            'profiler.performance.slowSeverity',
          ),
          // On-demand EXPLAIN: the SQL panel gets an "Explain" button per query. The demo DB is
          // PostgreSQL; a scan of the unindexed `products` table shows a Seq Scan in the plan.
          // `analyze: true` (dev only) runs EXPLAIN ANALYZE on SELECTs for real timings/rows.
          explain: { enabled: true, analyze: true },
        }),
      }),
      isProfilerEnabled,
    ),
    // Global-scope "Schema · TypeORM" home-page panel listing the registered entities.
    ConditionalModule.registerWhen(TypeOrmSchemaCollectorModule.forRoot(), isProfilerEnabled),
  ],
  providers: [{ provide: ProductRepository, useClass: TypeOrmProductRepository }],
  exports: [ProductRepository],
})
export class ProductTypeOrmModule {}
