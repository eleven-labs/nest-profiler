import { Module } from '@nestjs/common';
import { ProductRepository } from '../../domain/product.repository.js';
import { InMemoryProductRepository } from './product.in-memory.repository.js';

/**
 * In-memory adapter for the catalog context. Selected when `SQL_ORM=in-memory` (the default). Needs
 * no connection and no profiler collector — it is the path that keeps the app running with no
 * infrastructure. Sole provider/exporter of the {@link ProductRepository} port.
 */
@Module({
  providers: [{ provide: ProductRepository, useClass: InMemoryProductRepository }],
  exports: [ProductRepository],
})
export class ProductInMemoryModule {}
