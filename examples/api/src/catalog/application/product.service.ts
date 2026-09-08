import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { Span, TracerService } from '@eleven-labs/nest-profiler';
import { ProductRepository } from '../domain/product.repository.js';
import type { NewProduct, Product } from '../domain/product.js';
import { EventPublisher } from '../../notifications/domain/event-publisher.js';
import { PRODUCT_SEED } from './product.seed.js';

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
    private readonly tracer: TracerService,
    private readonly events: EventPublisher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.repo.clear();
    for (const seed of PRODUCT_SEED) {
      await this.repo.create(seed);
    }
    this.logger.log(`Database seeded with ${PRODUCT_SEED.length} products`);
  }

  @Span('db.products.findAll')
  async findAll(): Promise<Product[]> {
    this.logger.log('Fetching all products');
    const products = await this.repo.findAll();
    this.logger.debug(`Found ${products.length} products`);
    return products;
  }

  @Span('db.products.exportCsv')
  async exportCsv(): Promise<string> {
    this.logger.log('Streaming all products to CSV');
    return this.repo.streamCsv();
  }

  async findOne(id: number): Promise<Product> {
    this.logger.log(`Fetching product #${id}`);
    const product = await this.tracer.span('db.products.findOne', () => this.repo.findById(id));
    if (!product) {
      this.logger.warn(`Product #${id} not found`);
      throw new NotFoundException(`Product #${id} not found`);
    }
    return product;
  }

  async create(data: NewProduct): Promise<Product> {
    this.logger.log(`Creating product: ${data.name}`);
    const product = await this.tracer.span('db.products.create', () =>
      this.repo.create({ ...data, inStock: data.inStock ?? true }),
    );
    this.logger.log(`Product #${product.id} created`);
    // Published in-process (no broker needed), so every POST /products shows the emission in its
    // Events panel and the listener execution as its own `event` profile.
    await this.events.publish({
      name: 'product.created',
      payload: { id: product.id, name: product.name, price: product.price },
    });
    return product;
  }

  async update(id: number, data: Partial<NewProduct>): Promise<number> {
    this.logger.log(`Updating product #${id}`);
    // No existence check on purpose: a non-matching id issues an UPDATE that affects 0 rows —
    // a silent failure the profiler flags with the `zero-rows` tag.
    const affected = await this.tracer.span('db.products.update', () => this.repo.update(id, data));
    this.logger.log(`Product #${id} update affected ${affected} row(s)`);
    return affected;
  }

  async remove(id: number): Promise<void> {
    this.logger.log(`Deleting product #${id}`);
    await this.findOne(id);
    await this.tracer.span('db.products.delete', () => this.repo.delete(id));
    this.logger.log(`Product #${id} deleted`);
  }
}
