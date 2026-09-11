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

/**
 * A demo product inserted at bootstrap under a **fixed id**. Unlike {@link NewProduct}, the id is
 * part of the data: `REVIEW_SEED` and the documented demo URLs reference products 1-4 by number, so
 * they must not depend on where the database's id sequence happens to be.
 */
export interface SeededProduct extends NewProduct {
  id: number;
}
