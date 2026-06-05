import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { ProductRepository } from '../domain/product.repository.js';
import type { NewProduct, Product } from '../domain/product.js';

const SEED_DATA: NewProduct[] = [
  {
    name: 'NestJS Pro License',
    price: 99.99,
    description: 'Professional license for NestJS framework',
    inStock: true,
  },
  { name: 'ORM Handbook', price: 29.99, description: 'Complete guide to SQL ORMs', inStock: true },
  { name: 'Redis in Action', price: 49.99, description: 'Advanced Redis patterns', inStock: false },
  { name: 'Profiler Toolkit', price: 0, description: 'Open source profiler tools', inStock: true },
];

/**
 * Application service for the product bounded context. Depends only on the {@link ProductRepository}
 * port — the active SQL ORM (TypeORM, MikroORM, …) is chosen by the infrastructure module that binds
 * the port. Profiler spans live here so they describe behaviour, not the persistence technology.
 */
@Injectable()
export class ProductService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly repo: ProductRepository,
    private readonly profiler: ProfilerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.repo.clear();
    for (const seed of SEED_DATA) {
      await this.repo.create(seed);
    }
    this.logger.log(`Database seeded with ${SEED_DATA.length} products`);
  }

  async findAll(): Promise<Product[]> {
    this.logger.log('Fetching all products');
    const stop = this.profiler.startSpan('db.products.findAll');
    const products = await this.repo.findAll();
    stop();
    this.logger.debug(`Found ${products.length} products`);
    return products;
  }

  async findOne(id: number): Promise<Product> {
    this.logger.log(`Fetching product #${id}`);
    const stop = this.profiler.startSpan('db.products.findOne');
    const product = await this.repo.findById(id);
    stop();
    if (!product) {
      this.logger.warn(`Product #${id} not found`);
      throw new NotFoundException(`Product #${id} not found`);
    }
    return product;
  }

  async create(data: NewProduct): Promise<Product> {
    this.logger.log(`Creating product: ${data.name}`);
    const stop = this.profiler.startSpan('db.products.create');
    const product = await this.repo.create({ ...data, inStock: data.inStock ?? true });
    stop();
    this.logger.log(`Product #${product.id} created`);
    return product;
  }

  async remove(id: number): Promise<void> {
    this.logger.log(`Deleting product #${id}`);
    await this.findOne(id);
    const stop = this.profiler.startSpan('db.products.delete');
    await this.repo.delete(id);
    stop();
    this.logger.log(`Product #${id} deleted`);
  }
}
