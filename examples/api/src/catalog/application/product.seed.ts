import type { NewProduct } from '../domain/product.js';

/** Demo products inserted on startup by {@link ProductService.onApplicationBootstrap}. */
export const PRODUCT_SEED: NewProduct[] = [
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
