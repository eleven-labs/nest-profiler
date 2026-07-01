import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { isGraphQLEnabled, isSqlOrm } from '../config/features.config.js';
import { ProductController } from './http/product.controller.js';
import { ProductService } from './application/product.service.js';
import { ProductResolver } from './graphql/product.resolver.js';
import { CatalogGraphQLModule } from './graphql/catalog-graphql.module.js';
import { ProductTypeOrmModule } from './infrastructure/typeorm/product.typeorm.module.js';
import { ProductMikroOrmModule } from './infrastructure/mikro-orm/product.mikro-orm.module.js';
import { ProductInMemoryModule } from './infrastructure/in-memory/product.in-memory.module.js';

/**
 * Catalog bounded context (products). Owns the application layer + the REST and GraphQL entrypoints,
 * which depend only on the {@link ProductRepository} port. Exactly one infrastructure adapter is
 * selected by `SQL_ORM` and is the sole provider/exporter of the port:
 * `in-memory` (default, no database), `typeorm` or `mikro-orm`.
 *
 * The module is **always** loaded — with no SQL ORM it falls back to the in-memory adapter, so the
 * catalog (and its GraphQL API) runs even with zero infrastructure. The GraphQL transport is only
 * wired when `FEATURE_GRAPHQL` is on; `ProductResolver` stays a harmless unused provider otherwise.
 */
@Module({
  imports: [
    ConditionalModule.registerWhen(ProductInMemoryModule, isSqlOrm('in-memory')),
    ConditionalModule.registerWhen(ProductTypeOrmModule, isSqlOrm('typeorm')),
    ConditionalModule.registerWhen(ProductMikroOrmModule, isSqlOrm('mikro-orm')),
    ConditionalModule.registerWhen(CatalogGraphQLModule, isGraphQLEnabled),
  ],
  controllers: [ProductController],
  providers: [ProductService, ProductResolver],
})
export class CatalogModule {}
