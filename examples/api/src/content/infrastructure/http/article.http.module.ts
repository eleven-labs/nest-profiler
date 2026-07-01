import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';
import { isProfilerEnabled } from '../../../config/app.config.js';
import { ArticleGateway } from '../../domain/article-gateway.js';
import { AxiosArticleGateway } from './article.axios.gateway.js';

/**
 * HTTP adapter for the content context. Wires `@nestjs/axios` + the HTTP and cache profiler
 * collectors, and is the sole provider/exporter of the {@link ArticleGateway} port. Needs no
 * database, so the content context runs on any deployment (including serverless).
 */
@Module({
  imports: [
    HttpModule,
    HttpCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      captureResponseBody: true,
    }),
    CacheCollectorModule.forRoot({ enabled: isProfilerEnabled(process.env) }),
  ],
  providers: [{ provide: ArticleGateway, useClass: AxiosArticleGateway }],
  exports: [ArticleGateway],
})
export class ArticleHttpModule {}
