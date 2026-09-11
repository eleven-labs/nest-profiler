import type { NewReview } from '../domain/review.js';

/**
 * Demo reviews inserted on startup by {@link ReviewService.onApplicationBootstrap}. Authors are ids
 * in the external user directory (1-10) rather than names, so resolving `Review.author` in GraphQL
 * goes out over HTTP. Author 1 deliberately reviews two products: the default (unbatched) loader
 * then fetches the same profile twice, which is what earns the `n-plus-one` tag — and what
 * `FEATURE_DATALOADER=true` collapses into a single call.
 */
export const REVIEW_SEED: NewReview[] = [
  {
    productId: '1',
    rating: 5,
    comment: 'Excellent product, highly recommended!',
    authorId: 1,
    status: 'approved',
  },
  {
    productId: '1',
    rating: 4,
    comment: 'Very good, works as expected.',
    authorId: 2,
    status: 'approved',
  },
  {
    productId: '2',
    rating: 3,
    comment: 'Average quality, nothing special.',
    authorId: 3,
    status: 'approved',
  },
  {
    productId: '2',
    rating: 2,
    comment: 'Disappointed, does not match the description.',
    authorId: 4,
    status: 'pending',
  },
  {
    productId: '3',
    rating: 5,
    comment: 'Outstanding! Best purchase this year.',
    authorId: 1,
    status: 'approved',
  },
];
