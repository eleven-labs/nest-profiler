import type { NewProduct, Product } from './product.js';

/**
 * Persistence port for the products bounded context. The abstract class doubles as the DI token,
 * so the application layer injects `ProductRepository` and each infrastructure module binds it to
 * an ORM-specific implementation (`{ provide: ProductRepository, useClass: … }`).
 */
export abstract class ProductRepository {
  abstract findAll(): Promise<Product[]>;
  /**
   * Streams every product row and formats it as CSV (header + one line per row). Backed by a
   * streaming read (`QueryBuilder.stream()`), the concrete use case the profiler's streaming-read
   * collector instruments — a large export that must not buffer the whole result set in the ORM.
   */
  abstract streamCsv(): Promise<string>;
  abstract findById(id: number): Promise<Product | null>;
  abstract create(data: NewProduct): Promise<Product>;
  abstract delete(id: number): Promise<void>;
  abstract clear(): Promise<void>;
}
