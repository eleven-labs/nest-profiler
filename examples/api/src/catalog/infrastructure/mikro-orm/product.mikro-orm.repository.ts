import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { ProductRepository } from '../../domain/product.repository.js';
import type { NewProduct, Product } from '../../domain/product.js';
import { ProductEntity } from './product.mikro-orm.entity.js';

/** Maps the MikroORM entity (nullable columns) to the domain model (optional fields). */
function toDomain(entity: ProductEntity): Product {
  return {
    id: entity.id,
    name: entity.name,
    price: entity.price,
    description: entity.description ?? undefined,
    inStock: entity.inStock,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

@Injectable()
export class MikroOrmProductRepository implements ProductRepository {
  constructor(private readonly em: EntityManager) {}

  // Fork per operation so it works both during a request and at bootstrap (seeding), without
  // leaking the global identity map. Queries are still captured: the patched MikroORM logger is
  // global and reads the active request profile from CLS.

  async findAll(): Promise<Product[]> {
    const products = await this.em
      .fork()
      .find(ProductEntity, {}, { orderBy: { createdAt: 'DESC' } });
    return products.map(toDomain);
  }

  async findById(id: number): Promise<Product | null> {
    const product = await this.em.fork().findOne(ProductEntity, { id });
    return product ? toDomain(product) : null;
  }

  async create(data: NewProduct): Promise<Product> {
    const em = this.em.fork();
    const product = em.create(ProductEntity, data);
    await em.persist(product).flush();
    return toDomain(product);
  }

  async delete(id: number): Promise<void> {
    const em = this.em.fork();
    const product = await em.findOne(ProductEntity, { id });
    if (product) await em.remove(product).flush();
  }

  async clear(): Promise<void> {
    await this.em.fork().nativeDelete(ProductEntity, {});
  }
}
