import type {
  ExternalArticle,
  ExternalAuthor,
  ExternalTodo,
  ForwardedArticle,
  NewArticle,
} from './article.js';

/**
 * Outbound port to the external content source. The abstract class doubles as the DI token; the
 * infrastructure layer binds it to one of two interchangeable adapters — axios or native `fetch`,
 * selected by the `HTTP_CLIENT` env var. Keeping raw HTTP behind this port lets the application
 * layer own caching, enrichment and profiler spans without depending on any HTTP client.
 */
export abstract class ArticleGateway {
  abstract fetchArticles(limit: number): Promise<ExternalArticle[]>;
  abstract fetchAuthor(id: number): Promise<ExternalAuthor>;
  abstract fetchTodo(id: number): Promise<ExternalTodo>;
  abstract forwardArticle(article: NewArticle): Promise<ForwardedArticle>;
}
