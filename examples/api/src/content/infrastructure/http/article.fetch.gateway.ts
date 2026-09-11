import { Injectable } from '@nestjs/common';
import { ArticleGateway } from '../../domain/article-gateway.js';
import type {
  ExternalArticle,
  ExternalAuthor,
  ForwardedArticle,
  NewArticle,
} from '../../domain/article.js';

const API_BASE = 'https://jsonplaceholder.typicode.com';
/**
 * Stands in for an upstream that authenticates by query parameter — a common enough pattern,
 * and what makes the HTTP Client panel show `api_key=[REDACTED]`: the collector masks the
 * sensitive parameters of a recorded URL at capture, so the key never reaches a stored profile.
 */
const UPSTREAM_API_KEY = 'demo-upstream-key';

/** Parses a JSON response body, narrowing the `any` from `Response.json()` to the expected shape. */
async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * Native `fetch` adapter for {@link ArticleGateway} — selected when `HTTP_CLIENT=fetch`. It is a
 * drop-in alternative to {@link AxiosArticleGateway}: same external API, same behaviour, but every
 * call is captured by `FetchInstrumentation` (which patches `globalThis.fetch`) instead of the axios
 * adapter. No manual recording — all calls land in the HTTP Client panel automatically.
 */
@Injectable()
export class FetchArticleGateway implements ArticleGateway {
  async fetchArticles(limit: number): Promise<ExternalArticle[]> {
    const response = await fetch(`${API_BASE}/posts?_limit=${limit}&api_key=${UPSTREAM_API_KEY}`);
    return readJson<ExternalArticle[]>(response);
  }

  async fetchAuthor(id: number): Promise<ExternalAuthor> {
    const response = await fetch(`${API_BASE}/users/${id}`);
    return readJson<ExternalAuthor>(response);
  }

  async forwardArticle(article: NewArticle): Promise<ForwardedArticle> {
    const response = await fetch(`${API_BASE}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: article.title, body: article.body, userId: 1 }),
    });
    return readJson<ForwardedArticle>(response);
  }
}
