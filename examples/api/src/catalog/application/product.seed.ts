import type { SeededProduct } from '../domain/product.js';

/**
 * Demo products inserted on startup by {@link ProductService.onApplicationBootstrap}. The ids are
 * written down rather than generated: `REVIEW_SEED` references products 1-3 and the documented demo
 * URLs use those numbers, so they have to survive a redeploy that keeps its database.
 */
export const PRODUCT_SEED: SeededProduct[] = [
  {
    id: 1,
    name: 'NestJS Pro License',
    price: 99.99,
    description: 'Professional license for NestJS framework',
    inStock: true,
  },
  {
    id: 2,
    name: 'ORM Handbook',
    price: 29.99,
    description: 'Complete guide to SQL ORMs',
    inStock: true,
  },
  {
    id: 3,
    name: 'Redis in Action',
    price: 49.99,
    description: 'Advanced Redis patterns',
    inStock: false,
  },
  {
    id: 4,
    name: 'Profiler Toolkit',
    price: 0,
    description: 'Open source profiler tools',
    inStock: true,
  },
];
