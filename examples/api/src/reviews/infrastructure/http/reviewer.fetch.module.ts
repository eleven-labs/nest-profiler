import { Module } from '@nestjs/common';
import { ReviewerGateway } from '../../domain/reviewer-gateway.js';
import { FetchReviewerGateway } from './reviewer.fetch.gateway.js';

/**
 * Native `fetch` adapter for the reviews context's user directory — selected when
 * `HTTP_CLIENT=fetch`. Needs no HTTP-client dependency and no collector registration: the fetch
 * instrumentation installed by the content context patches `globalThis.fetch` process-wide.
 */
@Module({
  providers: [{ provide: ReviewerGateway, useClass: FetchReviewerGateway }],
  exports: [ReviewerGateway],
})
export class ReviewerFetchModule {}
