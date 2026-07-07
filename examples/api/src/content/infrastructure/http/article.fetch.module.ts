import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import { ArticleGateway } from '../../domain/article-gateway.js';
import { FetchArticleGateway } from './article.fetch.gateway.js';

/**
 * Native `fetch` adapter for the content context — selected when `HTTP_CLIENT=fetch`. Needs no
 * `@nestjs/axios` and no HTTP-client dependency; the fetch profiler instrumentation patches
 * `globalThis.fetch`. Sole provider/exporter of the {@link ArticleGateway} port. Demo captures both
 * bodies.
 */
@Module({
  imports: [
    ConditionalModule.registerWhen(
      HttpCollectorModule.forRoot({
        instrumentations: [FetchInstrumentation],
        captureRequestBody: true,
        captureResponseBody: true,
      }),
      isProfilerEnabled,
    ),
  ],
  providers: [{ provide: ArticleGateway, useClass: FetchArticleGateway }],
  exports: [ArticleGateway],
})
export class ArticleFetchModule {}
