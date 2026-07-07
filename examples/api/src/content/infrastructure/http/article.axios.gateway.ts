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
 * axios adapter for {@link ArticleGateway} — selected when `HTTP_CLIENT=axios` (the default). Every
 * call is captured automatically by `AxiosInstrumentation`, which auto-discovers the injected
 * `HttpService`; no manual recording needed, all land in the HTTP Client panel.
 */
@Injectable()
export class AxiosArticleGateway implements ArticleGateway {
  constructor(private readonly http: HttpService) {}

  async fetchArticles(limit: number): Promise<ExternalArticle[]> {
    const { data } = await firstValueFrom(
      this.http.get<ExternalArticle[]>(`${API_BASE}/posts?_limit=${limit}`),
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
