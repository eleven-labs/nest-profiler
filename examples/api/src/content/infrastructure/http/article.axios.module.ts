import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
import { ArticleGateway } from '../../domain/article-gateway.js';
import { AxiosArticleGateway } from './article.axios.gateway.js';

/**
 * axios adapter for the content context — selected when `HTTP_CLIENT=axios` (the default). Wires
 * `@nestjs/axios` `HttpModule` and the axios profiler instrumentation, and is the sole
 * provider/exporter of the {@link ArticleGateway} port. `AxiosInstrumentation` auto-discovers the
 * `HttpService`, so calls are captured with no per-instance wiring. Demo captures both bodies.
 */
@Module({
  imports: [
    HttpModule,
    ConditionalModule.registerWhen(
      HttpCollectorModule.forRoot({
        instrumentations: [AxiosInstrumentation],
        captureRequestBody: true,
        captureResponseBody: true,
      }),
      isProfilerEnabled,
    ),
  ],
  providers: [{ provide: ArticleGateway, useClass: AxiosArticleGateway }],
  exports: [ArticleGateway],
})
export class ArticleAxiosModule {}
