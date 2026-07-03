import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmCollectorModule } from '@eleven-labs/nest-profiler-typeorm';
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
        entities: [ProductEntity],
        // Recreate the schema from scratch outside production so switching SQL_ORM against the
        // shared `products` table always starts clean (the ORMs map columns differently).
        synchronize: config.get<string>('app.env') !== 'production',
        dropSchema: config.get<string>('app.env') !== 'production',
        logging: false,
      }),
    }),
    TypeOrmModule.forFeature([ProductEntity]),
    ConditionalModule.registerWhen(
      TypeOrmCollectorModule.forRoot({ slowQueryThreshold: 50 }),
      isProfilerEnabled,
    ),
  ],
  providers: [{ provide: ProductRepository, useClass: TypeOrmProductRepository }],
  exports: [ProductRepository],
})
export class ProductTypeOrmModule {}
