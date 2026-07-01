import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductRepository } from '../../domain/product.repository.js';
import type { NewProduct, Product } from '../../domain/product.js';
import { ProductEntity } from './product.typeorm.entity.js';

@Injectable()
export class TypeOrmProductRepository implements ProductRepository {
  constructor(@InjectRepository(ProductEntity) private readonly repo: Repository<ProductEntity>) {}

  findAll(): Promise<Product[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
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
