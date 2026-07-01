import { Module } from '@nestjs/common';
import { ArticleController } from './http/article.controller.js';
import { ArticleService } from './application/article.service.js';
import { SyncArticlesCommand } from './cli/sync-articles.command.js';
import { ArticleHttpModule } from './infrastructure/http/article.http.module.js';

/**
 * Content bounded context (blog articles from an external source). Owns the application layer plus
 * two entrypoints over the same use cases: the REST `ArticleController` (HTTP app) and the
 * `content:sync` CLI command. Depends only on the {@link ArticleGateway} port + the global cache —
 * no database — so it is always loaded, including on serverless deploys.
 */
@Module({
  imports: [ArticleHttpModule],
  controllers: [ArticleController],
  providers: [ArticleService, SyncArticlesCommand],
})
export class ContentModule {}
