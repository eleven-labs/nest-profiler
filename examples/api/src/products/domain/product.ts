/**
 * ORM-agnostic product model. Infrastructure adapters (TypeORM, MikroORM, …) map their own
 * entities to this shape so the application and HTTP layers never depend on a specific ORM.
 */
export interface Product {
  id: number;
  name: string;
  price: number;
  description?: string;
  inStock: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Data required to create a product (before persistence assigns id/timestamps). */
export interface NewProduct {
  name: string;
  price: number;
  description?: string;
  inStock?: boolean;
}
