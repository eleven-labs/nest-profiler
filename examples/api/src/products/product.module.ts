import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { isSqlOrm } from '../config/features.config.js';
import { ProductController } from './http/product.controller.js';
import { ProductService } from './application/product.service.js';
import { ProductTypeOrmModule } from './infrastructure/typeorm/product.typeorm.module.js';
import { ProductMikroOrmModule } from './infrastructure/mikro-orm/product.mikro-orm.module.js';

/**
 * Product bounded context. Owns the HTTP + application layers (controller, service) which depend
 * only on the {@link ProductRepository} port. Exactly one infrastructure adapter is selected by
 * `SQL_ORM` (mutually exclusive — they back the same Postgres `products` table) and is the sole
 * provider of `ProductRepository`, which it exports up to this module via `ConditionalModule`.
 *
 * `AppModule` only loads this module when `SQL_ORM != none`, so a `ProductRepository` is always
 * available to `ProductService`. The conditions are evaluated after `.env` is loaded.
 */
@Module({
  imports: [
    ConditionalModule.registerWhen(ProductTypeOrmModule, isSqlOrm('typeorm')),
    ConditionalModule.registerWhen(ProductMikroOrmModule, isSqlOrm('mikro-orm')),
  ],
  controllers: [ProductController],
  providers: [ProductService],
})
export class ProductModule {}
