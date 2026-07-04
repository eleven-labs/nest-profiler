import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { HttpModule, HttpService } from '@nestjs/axios';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';
import { isProfilerEnabled } from '../../../config/profiler.config.js';
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
    ConditionalModule.registerWhen(
      // The profiler package never imports @nestjs/axios: we hand it our HttpService.axiosRef
      // via forRootAsync. `HttpModule` is a static singleton, so the axiosRef instrumented here
      // is the same one the gateway uses. Demo captures both bodies for the HTTP Client panel.
      HttpCollectorModule.forRootAsync({
        imports: [HttpModule],
        inject: [HttpService],
        useFactory: (http: HttpService) => ({
          axiosRef: http.axiosRef,
          captureRequestBody: true,
          captureResponseBody: true,
        }),
      }),
      isProfilerEnabled,
    ),
    ConditionalModule.registerWhen(CacheCollectorModule.forRoot(), isProfilerEnabled),
  ],
  providers: [{ provide: ArticleGateway, useClass: AxiosArticleGateway }],
  exports: [ArticleGateway],
})
export class ArticleHttpModule {}
