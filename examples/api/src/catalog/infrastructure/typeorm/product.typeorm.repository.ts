import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductRepository } from '../../domain/product.repository.js';
import type { NewProduct, Product } from '../../domain/product.js';
import { ProductEntity } from './product.typeorm.entity.js';
import { toCsvRow } from '../../../shared/csv.util.js';

@Injectable()
export class TypeOrmProductRepository implements ProductRepository {
  constructor(@InjectRepository(ProductEntity) private readonly repo: Repository<ProductEntity>) {}

  findAll(): Promise<Product[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  // Exports rows through TypeORM's QueryBuilder.stream() (→ QueryRunner.stream()), the path the
  // profiler's streaming-read collector instruments. Explicit column aliases keep the raw stream
  // rows flat (`{ id, name, price }`) instead of the default `product_*` prefixes.
  async streamCsv(): Promise<string> {
    const stream = await this.repo
      .createQueryBuilder('product')
      .select('product.id', 'id')
      .addSelect('product.name', 'name')
      .addSelect('product.price', 'price')
      .orderBy('product.createdAt', 'DESC')
      .stream();
    const lines: string[] = ['id,name,price'];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) => {
        const row = chunk as unknown as { id: number; name: string; price: number };
        lines.push(toCsvRow([row.id, row.name, row.price]));
      });
      stream.on('error', reject);
      stream.on('end', () => resolve());
    });
    return lines.join('\n');
  }

  findById(id: number): Promise<Product | null> {
    return this.repo.findOneBy({ id });
  }

  create(data: NewProduct): Promise<Product> {
    return this.repo.save(this.repo.create(data));
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  async clear(): Promise<void> {
    await this.repo.clear();
  }
}
