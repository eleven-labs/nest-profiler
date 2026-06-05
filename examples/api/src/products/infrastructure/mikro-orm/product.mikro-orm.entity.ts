import { defineEntity, p } from '@mikro-orm/core';

// MikroORM v7 defines entities programmatically with `defineEntity` (decorators were removed).
export const ProductSchema = defineEntity({
  name: 'Product',
  tableName: 'products',
  properties: {
    id: p.integer().primary().autoincrement(),
    name: p.string().length(200),
    price: p.float(),
    description: p.text().nullable(),
    inStock: p.boolean().default(true),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export class ProductEntity extends ProductSchema.class {}
ProductSchema.setClass(ProductEntity);
