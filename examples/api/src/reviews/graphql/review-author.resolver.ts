import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ReviewerLoader } from '../domain/reviewer-loader.js';
import { ReviewType } from './review.type.js';
import { ReviewAuthorType } from './review-author.type.js';
import type { Reviewer } from '../domain/reviewer.js';

/**
 * Third source of the catalog query: a review only stores its author's id, and this field resolver
 * turns it into a profile fetched over HTTP from the external user directory. Combined with
 * {@link ProductReviewsResolver}, one `{ products { reviews { author } } }` query walks the SQL
 * catalog, the MongoDB reviews and an HTTP API — the three collectors then sit side by side in the
 * same profile, each with its own panel and its own bars in the waterfall.
 *
 * How the calls are issued is the {@link ReviewerLoader}'s business: N+1 by default, or a single
 * batched call with `FEATURE_DATALOADER=true`.
 */
@Resolver(() => ReviewType)
export class ReviewAuthorResolver {
  constructor(private readonly reviewers: ReviewerLoader) {}

  @ResolveField(() => ReviewAuthorType, {
    nullable: true,
    description: 'Author profile, resolved over HTTP from the external user directory',
  })
  author(@Parent() review: ReviewType): Promise<Reviewer | null> {
    return this.reviewers.load(review.authorId);
  }
}
