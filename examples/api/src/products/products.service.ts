import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { Product } from './product.entity';
import type { CreateProductDto } from './dto/create-product.dto';

const SEED_DATA: CreateProductDto[] = [
  {
    name: 'NestJS Pro License',
    price: 99.99,
    description: 'Professional license for NestJS framework',
    inStock: true,
  },
  {
    name: 'TypeORM Handbook',
    price: 29.99,
    description: 'Complete guide to TypeORM',
    inStock: true,
  },
  { name: 'Redis in Action', price: 49.99, description: 'Advanced Redis patterns', inStock: false },
  { name: 'Profiler Toolkit', price: 0, description: 'Open source profiler tools', inStock: true },
];

@Injectable()
export class ProductsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product) private readonly repo: Repository<Product>,
    private readonly profiler: ProfilerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.repo.clear();
    await Promise.all(SEED_DATA.map((s) => this.repo.save(this.repo.create(s))));
    this.logger.log(`Database seeded with ${SEED_DATA.length} products`);
  }

  async findAll(): Promise<Product[]> {
    this.logger.log('Fetching all products');
    const stop = this.profiler.startSpan('db.products.findAll');
    const products = await this.repo.find({ order: { createdAt: 'DESC' } });
    stop();
    this.logger.debug(`Found ${products.length} products`);
    return products;
  }

  async findOne(id: number): Promise<Product> {
    this.logger.log(`Fetching product #${id}`);
    const stop = this.profiler.startSpan('db.products.findOne');
    const product = await this.repo.findOneBy({ id });
    stop();
    if (!product) {
      this.logger.warn(`Product #${id} not found`);
      throw new NotFoundException(`Product #${id} not found`);
    }
    return product;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    this.logger.log(`Creating product: ${dto.name}`);
    const stop = this.profiler.startSpan('db.products.create');
    const product = this.repo.create({ ...dto, inStock: dto.inStock ?? true });
    const saved = await this.repo.save(product);
    stop();
    this.logger.log(`Product #${saved.id} created`);
    return saved;
  }

  async remove(id: number): Promise<void> {
    this.logger.log(`Deleting product #${id}`);
    const product = await this.findOne(id);
    const stop = this.profiler.startSpan('db.products.delete');
    await this.repo.remove(product);
    stop();
    this.logger.log(`Product #${id} deleted`);
  }
}
