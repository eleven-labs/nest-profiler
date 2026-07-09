import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { CacheCollectorModule } from '@eleven-labs/nest-profiler-cache';
import { isHttpClient } from '../config/features.config.js';
import { isProfilerEnabled } from '../config/profiler.config.js';
import { ArticleController } from './http/article.controller.js';
import { ArticleService } from './application/article.service.js';
import { SyncArticlesCommand } from './cli/sync-articles.command.js';
import { ArticleAxiosModule } from './infrastructure/http/article.axios.module.js';
import { ArticleFetchModule } from './infrastructure/http/article.fetch.module.js';

/**
 * Content bounded context (blog articles from an external source). Owns the application layer plus
 * two entrypoints over the same use cases: the REST `ArticleController` (HTTP app) and the
 * `content:sync` CLI command. Depends only on the {@link ArticleGateway} port + the global cache —
 * no database — so it is always loaded, including on serverless deploys.
 *
 * Exactly one HTTP adapter is selected by `HTTP_CLIENT` and is the sole provider/exporter of the
 * port: `axios` (default) or native `fetch` — mirroring how `SQL_ORM` selects the catalog adapter.
 */
@Module({
  imports: [
    ConditionalModule.registerWhen(ArticleAxiosModule, isHttpClient('axios')),
    ConditionalModule.registerWhen(ArticleFetchModule, isHttpClient('fetch')),
    ConditionalModule.registerWhen(CacheCollectorModule.forRoot(), isProfilerEnabled),
  ],
  controllers: [ArticleController],
  providers: [ArticleService, SyncArticlesCommand],
})
export class ContentModule {}
