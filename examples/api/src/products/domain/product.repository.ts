import type { NewProduct, Product } from './product.js';

/**
 * Persistence port for the products bounded context. The abstract class doubles as the DI token,
 * so the application layer injects `ProductRepository` and each infrastructure module binds it to
 * an ORM-specific implementation (`{ provide: ProductRepository, useClass: … }`).
 */
export abstract class ProductRepository {
  abstract findAll(): Promise<Product[]>;
  abstract findById(id: number): Promise<Product | null>;
  abstract create(data: NewProduct): Promise<Product>;
  abstract delete(id: number): Promise<void>;
  abstract clear(): Promise<void>;
}
