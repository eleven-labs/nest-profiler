import { Injectable } from '@nestjs/common';
import { TracerService } from '@eleven-labs/nest-profiler';
import { ProductReviewsLoader } from '../../domain/product-reviews-loader.js';
import { ReviewerLoader } from '../../domain/reviewer-loader.js';
import { ReviewerGateway } from '../../domain/reviewer-gateway.js';
import { ReviewService } from '../../application/review.service.js';
import type { Review } from '../../domain/review.js';
import type { Reviewer } from '../../domain/reviewer.js';

/**
 * Default {@link ProductReviewsLoader}: one MongoDB query per product, issued as the field is
 * reached. Listing four products therefore runs four `find({ productId })` queries — the repetition
 * the profiler tags `n-plus-one` in the MongoDB panel. The read goes through {@link ReviewService},
 * so the REST and GraphQL entrypoints share the same `db.reviews.*` span.
 */
@Injectable()
export class DirectProductReviewsLoader implements ProductReviewsLoader {
  constructor(private readonly reviews: ReviewService) {}

  load(productId: string): Promise<Review[]> {
    return this.reviews.findByProduct(productId);
  }
}

/**
 * Default {@link ReviewerLoader}: one request per author, resolved as the field is reached. Listing
 * products then resolving every review's author is the textbook GraphQL N+1 — and the reason the
 * profiler flags it, since two reviews written by the same author produce two identical
 * `GET /users/:id` calls. Turn `FEATURE_DATALOADER=true` on to compare with the batched adapter.
 */
@Injectable()
export class DirectReviewerLoader implements ReviewerLoader {
  constructor(
    private readonly gateway: ReviewerGateway,
    private readonly tracer: TracerService,
  ) {}

  load(id: number): Promise<Reviewer | null> {
    return this.tracer.span('http.reviews.author', (span) => {
      span.setTag('authorId', id);
      return this.gateway.fetchReviewer(id);
    });
  }
}
