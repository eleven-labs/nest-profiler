import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ProductService } from '../application/product.service.js';
import { ProductType } from './product.type.js';
import { CreateProductInput } from './create-product.input.js';
import type { Product } from '../domain/product.js';

/**
 * GraphQL entrypoint for the catalog. Thin — it delegates to {@link ProductService}, which owns the
 * business logic and the profiler spans (so behaviour is described in one place regardless of the
 * transport). The same service backs the REST `ProductController`.
 */
@Resolver(() => ProductType)
export class ProductResolver {
  constructor(private readonly catalog: ProductService) {}

  @Query(() => [ProductType], { description: 'List all products' })
  products(): Promise<Product[]> {
    return this.catalog.findAll();
  }

  @Query(() => ProductType, { nullable: true, description: 'Retrieve a single product by id' })
  product(@Args('id', { type: () => Int }) id: number): Promise<Product> {
    return this.catalog.findOne(id);
  }

  @Mutation(() => ProductType, { description: 'Create a new product' })
  createProduct(@Args('input') input: CreateProductInput): Promise<Product> {
    return this.catalog.create(input);
  }
}
