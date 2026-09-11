import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReviewerGateway } from '../../domain/reviewer-gateway.js';
import { AxiosReviewerGateway } from './reviewer.axios.gateway.js';

/**
 * axios adapter for the reviews context's user directory — selected when `HTTP_CLIENT=axios`. Sole
 * provider/exporter of the {@link ReviewerGateway} port. It deliberately registers **no**
 * `HttpCollectorModule`: the content context already registered the HTTP Client panel, and the
 * axios instrumentation auto-discovers this module's own `HttpService` — which is the point worth
 * seeing, a second axios instance profiled with zero extra wiring.
 */
@Module({
  imports: [HttpModule],
  providers: [{ provide: ReviewerGateway, useClass: AxiosReviewerGateway }],
  exports: [ReviewerGateway],
})
export class ReviewerAxiosModule {}
