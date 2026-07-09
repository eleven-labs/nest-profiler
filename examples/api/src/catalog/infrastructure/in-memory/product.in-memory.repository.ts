import { Injectable } from '@nestjs/common';
import { ProductRepository } from '../../domain/product.repository.js';
import type { NewProduct, Product } from '../../domain/product.js';
import { toCsvRow } from '../../../shared/csv.util.js';

/**
 * Zero-infrastructure adapter — the default when `SQL_ORM=in-memory`. Lets the catalog (REST +
 * GraphQL) run without a database, e.g. on serverless deploys. State is per-process, which is fine
 * for a demo: each request/instance re-seeds via `ProductService.onApplicationBootstrap`.
 */
@Injectable()
export class InMemoryProductRepository implements ProductRepository {
  private products: Product[] = [];
  private sequence = 1;

  findAll(): Promise<Product[]> {
    return Promise.resolve(
      [...this.products].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  streamCsv(): Promise<string> {
    // No real stream without a database; format the in-memory rows so the endpoint still responds.
    const lines = ['id,name,price'];
    for (const p of [...this.products].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )) {
      lines.push(toCsvRow([p.id, p.name, p.price]));
    }
    return Promise.resolve(lines.join('\n'));
  }

  findById(id: number): Promise<Product | null> {
    return Promise.resolve(this.products.find((product) => product.id === id) ?? null);
  }

  create(data: NewProduct): Promise<Product> {
    const now = new Date();
    const product: Product = {
      id: this.sequence++,
      name: data.name,
      price: data.price,
      description: data.description,
      inStock: data.inStock ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.products.push(product);
    return Promise.resolve(product);
  }

  delete(id: number): Promise<void> {
    this.products = this.products.filter((product) => product.id !== id);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.products = [];
    this.sequence = 1;
    return Promise.resolve();
  }
}
