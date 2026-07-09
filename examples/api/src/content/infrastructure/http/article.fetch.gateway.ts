import { Injectable } from '@nestjs/common';
import { ArticleGateway } from '../../domain/article-gateway.js';
import type {
  ExternalArticle,
  ExternalAuthor,
  ExternalTodo,
  ForwardedArticle,
  NewArticle,
} from '../../domain/article.js';

const API_BASE = 'https://jsonplaceholder.typicode.com';

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
    const response = await fetch(`${API_BASE}/posts?_limit=${limit}`);
    return readJson<ExternalArticle[]>(response);
  }

  async fetchAuthor(id: number): Promise<ExternalAuthor> {
    const response = await fetch(`${API_BASE}/users/${id}`);
    return readJson<ExternalAuthor>(response);
  }

  async fetchTodo(id: number): Promise<ExternalTodo> {
    const response = await fetch(`${API_BASE}/todos/${id}`);
    return readJson<ExternalTodo>(response);
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
