import type { NewReview, Review, ReviewStats } from './review.js';

/**
 * Persistence port for the reviews bounded context. The abstract class doubles as the DI token, so
 * the application layer injects `ReviewRepository` and the Mongoose infrastructure module binds it
 * to a concrete implementation (`{ provide: ReviewRepository, useClass: … }`).
 */
export abstract class ReviewRepository {
  abstract findAll(): Promise<Review[]>;
  /**
   * Streams every review document via a cursor and formats it as CSV (header + one line per doc).
   * The concrete streaming-read use case: exporting a large collection without loading it all.
   */
  abstract streamCsv(): Promise<string>;
  abstract findApproved(): Promise<Review[]>;
  abstract findByProduct(productId: string): Promise<Review[]>;
  abstract findById(id: string): Promise<Review | null>;
  abstract create(data: NewReview): Promise<Review>;
  abstract delete(id: string): Promise<void>;
  abstract clear(): Promise<void>;
  abstract stats(): Promise<ReviewStats[]>;
}
