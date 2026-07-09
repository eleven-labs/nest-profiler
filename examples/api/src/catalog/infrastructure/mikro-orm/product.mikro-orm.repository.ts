import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import type { EntityManager as SqlEntityManager } from '@mikro-orm/postgresql';
import { ProductRepository } from '../../domain/product.repository.js';
import type { NewProduct, Product } from '../../domain/product.js';
import { ProductEntity } from './product.mikro-orm.entity.js';
import { toCsvRow } from '../../../shared/csv.util.js';

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

  // Exports rows through MikroORM's QueryBuilder.stream(). The SQL EntityManager exposes
  // createQueryBuilder (absent from the core EntityManager type), so the fork is cast.
  async streamCsv(): Promise<string> {
    const em = this.em.fork() as unknown as SqlEntityManager;
    const qb = em.createQueryBuilder(ProductEntity).orderBy({ createdAt: 'DESC' });
    const lines: string[] = ['id,name,price'];
    for await (const p of qb.stream()) {
      lines.push(toCsvRow([p.id, p.name, p.price]));
    }
    return lines.join('\n');
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
