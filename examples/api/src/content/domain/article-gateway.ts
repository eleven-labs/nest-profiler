import type { ExternalArticle, ExternalAuthor, ExternalTodo, NewArticle } from './article.js';

/**
 * Outbound port to the external content source. The abstract class doubles as the DI token; the
 * infrastructure layer binds it to an adapter that talks to the API (axios) and also demonstrates a
 * native `fetch` call. Keeping raw HTTP behind this port lets the application layer own caching,
 * enrichment and profiler spans without depending on any HTTP client.
 */
export abstract class ArticleGateway {
  abstract fetchArticles(limit: number): Promise<ExternalArticle[]>;
  abstract fetchAuthor(id: number): Promise<ExternalAuthor>;
  abstract fetchTodo(id: string): Promise<ExternalTodo>;
  abstract forwardArticle(article: NewArticle): Promise<unknown>;
  /** Fetches a single article with the native `fetch` API, recorded via `HttpProfilerRecorder`. */
  abstract fetchFirstArticleViaNativeFetch(): Promise<unknown>;
}
