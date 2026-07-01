/**
 * Persistence-agnostic review model. Infrastructure adapters (Mongoose, …) map their own documents
 * to this shape so the application and HTTP layers never depend on Mongoose.
 */
export interface Review {
  id: string;
  productId: string;
  rating: number;
  comment: string;
  author: string;
  status: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type ReviewStatus = 'pending' | 'approved';

/** Data required to create a review (before persistence assigns id/timestamps). */
export interface NewReview {
  productId: string;
  rating: number;
  comment: string;
  author: string;
  status?: ReviewStatus;
}

/** Aggregated rating statistics per product. */
export interface ReviewStats {
  productId: string;
  avgRating: number;
  count: number;
}
