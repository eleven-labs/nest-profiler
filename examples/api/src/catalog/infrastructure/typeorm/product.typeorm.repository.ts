import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductRepository } from '../../domain/product.repository.js';
import type { NewProduct, Product, SeededProduct } from '../../domain/product.js';
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

  async update(id: number, data: Partial<NewProduct>): Promise<number> {
    const result = await this.repo.update(id, data);
    return result.affected ?? 0;
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  async seed(products: readonly SeededProduct[]): Promise<void> {
    // Naming the columns is what carries the explicit id: an InsertQueryBuilder leaves a generated
    // primary key out of the statement unless the column list asks for it.
    const columns = this.repo.metadata.columns.map((column) => column.propertyName);
    for (const product of products) {
      const now = new Date();
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(ProductEntity, columns)
        .values({ inStock: true, ...product, createdAt: now, updatedAt: now })
        // ON CONFLICT DO NOTHING — another instance may be seeding the same database right now.
        .orIgnore()
        .execute();
    }
    // The explicit ids never drew from the sequence, so move it past them: without this the next
    // `create()` would hand out an id the seed already took.
    const table = this.repo.metadata.tableName;
    await this.repo.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "${table}"))`,
    );
  }

  async clear(): Promise<void> {
    await this.repo.clear();
  }
}
