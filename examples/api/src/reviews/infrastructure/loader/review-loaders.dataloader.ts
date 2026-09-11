import { Injectable, Scope } from '@nestjs/common';
import DataLoader from 'dataloader';
import { TracerService } from '@eleven-labs/nest-profiler';
import { ProductReviewsLoader } from '../../domain/product-reviews-loader.js';
import { ReviewerLoader } from '../../domain/reviewer-loader.js';
import { ReviewerGateway } from '../../domain/reviewer-gateway.js';
import { ReviewService } from '../../application/review.service.js';
import type { Review } from '../../domain/review.js';
import type { Reviewer } from '../../domain/reviewer.js';

/**
 * Batched {@link ProductReviewsLoader} — selected when `FEATURE_DATALOADER=true`. GraphQL asks for
 * every product's reviews in the same tick, so the whole list is resolved by one
 * `find({ productId: { $in: [...] } })` instead of one query per product.
 *
 * It is also the first domino of the HTTP batching: because every review is now returned by the
 * same query, the `author` field resolvers all run in the same tick and {@link DataLoaderReviewerLoader}
 * can fold them into a single `GET /users?id=…` call.
 *
 * `Scope.REQUEST` keeps the loader's cache private to one request.
 */
@Injectable({ scope: Scope.REQUEST })
export class DataLoaderProductReviewsLoader implements ProductReviewsLoader {
  private readonly loader: DataLoader<string, Review[]>;

  constructor(reviews: ReviewService) {
    this.loader = new DataLoader<string, Review[]>(async (productIds) => {
      const found = await reviews.findByProducts(productIds);

      const byProduct = new Map<string, Review[]>();
      for (const review of found) {
        const current = byProduct.get(review.productId);
        if (current) current.push(review);
        else byProduct.set(review.productId, [review]);
      }
      // DataLoader requires one result per requested key, in order — a product with no review
      // yields an empty list.
      return productIds.map((productId) => byProduct.get(productId) ?? []);
    });
  }

  load(productId: string): Promise<Review[]> {
    return this.loader.load(productId);
  }
}

/**
 * Batched {@link ReviewerLoader} — selected when `FEATURE_DATALOADER=true`. Every `load()` issued in
 * the same tick is collected into one `GET /users?id=…` call, and repeated ids are deduplicated by
 * the loader's own cache, so the N+1 of {@link DirectReviewerLoader} collapses into a single
 * outgoing request no matter how many reviews the query resolves.
 *
 * `Scope.REQUEST` is what makes the cache safe: the loader (and the resolver injecting it) is
 * instantiated per request, so one client never reads another's authors. Nest propagates the scope
 * to `ReviewAuthorResolver` on its own — nothing else in the context is touched.
 */
@Injectable({ scope: Scope.REQUEST })
export class DataLoaderReviewerLoader implements ReviewerLoader {
  private readonly loader: DataLoader<number, Reviewer | null>;

  constructor(gateway: ReviewerGateway, tracer: TracerService) {
    this.loader = new DataLoader<number, Reviewer | null>(async (ids) => {
      // The batch call is opened as a span, so the waterfall shows one bar covering every author
      // instead of N bars flat against the request.
      const reviewers = await tracer.span('http.reviews.authors.batch', (span) => {
        span.setTag('authors', ids.length);
        return gateway.fetchReviewers(ids);
      });
      const byId = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer]));
      // DataLoader requires one result per requested key, in order — an unknown author yields null.
      return ids.map((id) => byId.get(id) ?? null);
    });
  }

  load(id: number): Promise<Reviewer | null> {
    return this.loader.load(id);
  }
}
