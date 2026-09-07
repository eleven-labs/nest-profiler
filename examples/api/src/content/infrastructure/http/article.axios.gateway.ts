import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ArticleGateway } from '../../domain/article-gateway.js';
import type {
  ExternalArticle,
  ExternalAuthor,
  ExternalTodo,
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

/**
 * axios adapter for {@link ArticleGateway} — selected when `HTTP_CLIENT=axios` (the default). Every
 * call is captured automatically by `AxiosInstrumentation`, which auto-discovers the injected
 * `HttpService`; no manual recording needed, all land in the HTTP Client panel.
 */
@Injectable()
export class AxiosArticleGateway implements ArticleGateway {
  constructor(private readonly http: HttpService) {}

  async fetchArticles(limit: number): Promise<ExternalArticle[]> {
    const { data } = await firstValueFrom(
      this.http.get<ExternalArticle[]>(
        `${API_BASE}/posts?_limit=${limit}&api_key=${UPSTREAM_API_KEY}`,
      ),
    );
    return data;
  }

  async fetchAuthor(id: number): Promise<ExternalAuthor> {
    const { data } = await firstValueFrom(this.http.get<ExternalAuthor>(`${API_BASE}/users/${id}`));
    return data;
  }

  async fetchTodo(id: number): Promise<ExternalTodo> {
    const { data } = await firstValueFrom(this.http.get<ExternalTodo>(`${API_BASE}/todos/${id}`));
    return data;
  }

  async forwardArticle(article: NewArticle): Promise<ForwardedArticle> {
    const { data } = await firstValueFrom(
      this.http.post<ForwardedArticle>(`${API_BASE}/posts`, {
        title: article.title,
        body: article.body,
        userId: 1,
      }),
    );
    return data;
  }
}
