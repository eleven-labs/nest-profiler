import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import {
  MikroOrmCollectorModule,
  MikroOrmSchemaCollectorModule,
} from '@eleven-labs/nest-profiler-mikro-orm';
import databaseConfig from '../../../config/database.config.js';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import { ProductRepository } from '../../domain/product.repository.js';
import { ProductEntity } from './product.mikro-orm.entity.js';
import { MikroOrmProductRepository } from './product.mikro-orm.repository.js';
import { MikroOrmSchemaInitializer } from './product.mikro-orm.schema-initializer.js';

/**
 * MikroORM adapter for the products context. Selected when `SQL_ORM=mikro-orm`. Its only role is to
 * wire the Postgres connection + the MikroORM profiler collector and provide/export the
 * {@link ProductRepository} port — the controller/service live in `ProductModule`.
 */
@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        driver: PostgreSqlDriver,
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        user: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        dbName: config.get<string>('database.name'),
        entities: [ProductEntity],
        debug: false,
      }),
    }),
    MikroOrmModule.forFeature([ProductEntity]),
    ConditionalModule.registerWhen(
      MikroOrmCollectorModule.forRoot({ slowThreshold: 50 }),
      isProfilerEnabled,
    ),
    // Global-scope "Schema · MikroORM" home-page panel listing the registered entities.
    ConditionalModule.registerWhen(MikroOrmSchemaCollectorModule.forRoot(), isProfilerEnabled),
  ],
  providers: [
    MikroOrmSchemaInitializer,
    { provide: ProductRepository, useClass: MikroOrmProductRepository },
  ],
  exports: [ProductRepository],
})
export class ProductMikroOrmModule {}
