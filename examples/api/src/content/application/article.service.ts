import { Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ArticleGateway } from '../domain/article-gateway.js';
import type { Article, NewArticle } from '../domain/article.js';

const ARTICLES_CACHE_KEY = 'external:articles';
const TODOS_CACHE_KEY = 'external:todos';

/**
 * Content use cases. Depends only on the {@link ArticleGateway} port — raw HTTP (axios / native
 * fetch) lives in the adapter. Owns the caching, author enrichment and profiler spans so they
 * describe behaviour (`http.articles.*`). The same service backs the REST controller and the
 * `content:sync` CLI command.
 */
@Injectable()
export class ArticleService {
  // Only set when FEATURE_PINO_LOGGER=true; wrapped here because injected loggers bypass app.useLogger().
  private readonly logger?: PinoLogger;

  constructor(
    private readonly gateway: ArticleGateway,
    private readonly profiler: ProfilerService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Optional()
    @InjectPinoLogger(ArticleService.name)
    pinoLogger?: PinoLogger,
  ) {
    this.logger = pinoLogger ? this.profiler.createLogger(pinoLogger) : undefined;
  }

  /** Fetch articles then resolve each author in parallel (N+1 calls), cached. */
  async getEnrichedArticles(): Promise<Article[]> {
    const cached = await this.cache.get<Article[]>(ARTICLES_CACHE_KEY);
    if (cached) {
      this.logger?.info('Articles served from cache (HIT)');
      return cached;
    }

    this.logger?.info('Fetching articles from external API (MISS)');
    const stopArticles = this.profiler.startSpan('http.articles');
    const articles = await this.gateway.fetchArticles(5);
    stopArticles();

    const authorIds = [...new Set(articles.map((a) => a.userId))];
    const stopAuthors = this.profiler.startSpan('http.articles.authors');
    const authors = await Promise.all(authorIds.map((id) => this.gateway.fetchAuthor(id)));
    stopAuthors();

    const authorMap = new Map(authors.map((author) => [author.id, author]));
    this.logger?.info(
      { articleCount: articles.length, authorCount: authorMap.size, cacheKey: ARTICLES_CACHE_KEY },
      'Resolved authors, caching enriched articles',
    );

    const enriched: Article[] = articles.map((article) => {
      const author = authorMap.get(article.userId);
      return {
        id: article.id,
        title: article.title,
        body: article.body,
        author: author
          ? {
              id: author.id,
              name: author.name,
              username: author.username,
              email: author.email,
              company: author.company.name,
            }
          : null,
      };
    });

    await this.cache.set(ARTICLES_CACHE_KEY, enriched, 30000);
    return enriched;
  }

  /** Build a synthetic article (no outgoing call) — exercises the validator panel. */
  createArticle(dto: NewArticle): Record<string, unknown> {
    this.logger?.info(`Creating article: ${dto.title}`);
    return {
      id: Math.floor(Math.random() * 1000) + 100,
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      coverImageUrl: dto.coverImageUrl ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  /** Forward an article to the external API via an axios POST. */
  async forwardArticle(dto: NewArticle): Promise<unknown> {
    this.logger?.info(`Forwarding article to external API: ${dto.title}`);
    const stop = this.profiler.startSpan('http.articles.forward');
    const result = await this.gateway.forwardArticle(dto);
    stop();
    return result;
  }

  /** Fetch a single article via the native fetch API (recorded in the HTTP Client panel). */
  getViaFetch(): Promise<unknown> {
    this.logger?.info('Fetching article via native fetch');
    return this.gateway.fetchFirstArticleViaNativeFetch();
  }

  /** Fetch a todo with its assignee — two concurrent calls, cached. */
  async getTodo(id: string): Promise<unknown> {
    const key = `${TODOS_CACHE_KEY}:${id}`;
    const cached = await this.cache.get(key);
    if (cached) {
      this.logger?.info(`Todo #${id} served from cache (HIT)`);
      return cached;
    }

    this.logger?.info(`Fetching todo #${id} and assignee in parallel (MISS)`);
    const stop = this.profiler.startSpan('http.todo');
    const [todo, assignee] = await Promise.all([
      this.gateway.fetchTodo(id),
      this.gateway.fetchAuthor(Number(id)),
    ]);
    stop();

    const enriched = {
      ...todo,
      assignee: {
        id: assignee.id,
        name: assignee.name,
        username: assignee.username,
        email: assignee.email,
      },
    };

    await this.cache.set(key, enriched, 60000);
    return enriched;
  }

  /** Fetch articles and cache them under a given key — used by the `content:sync` CLI command. */
  async syncArticles(limit: number, cacheKey: string): Promise<number> {
    const stop = this.profiler.startSpan('cli.content-sync.fetch');
    const articles = await this.gateway.fetchArticles(limit);
    stop();
    await this.cache.set(cacheKey, articles, 60000);
    return articles.length;
  }

  /** Clear the articles cache, forcing a MISS on the next fetch. */
  async clearCache(): Promise<{ cleared: boolean }> {
    await this.cache.del(ARTICLES_CACHE_KEY);
    this.logger?.info('Articles cache cleared');
    return { cleared: true };
  }
}
