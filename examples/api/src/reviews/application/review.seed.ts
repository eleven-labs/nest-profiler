import type { NewReview } from '../domain/review.js';

/** Demo reviews inserted on startup by {@link ReviewService.onApplicationBootstrap}. */
export const REVIEW_SEED: NewReview[] = [
  {
    productId: '1',
    rating: 5,
    comment: 'Excellent product, highly recommended!',
    author: 'Alice',
    status: 'approved',
  },
  {
    productId: '1',
    rating: 4,
    comment: 'Very good, works as expected.',
    author: 'Bob',
    status: 'approved',
  },
  {
    productId: '2',
    rating: 3,
    comment: 'Average quality, nothing special.',
    author: 'Carol',
    status: 'approved',
  },
  {
    productId: '2',
    rating: 2,
    comment: 'Disappointed, does not match the description.',
    author: 'Dave',
    status: 'pending',
  },
  {
    productId: '3',
    rating: 5,
    comment: 'Outstanding! Best purchase this year.',
    author: 'Eve',
    status: 'approved',
  },
];
