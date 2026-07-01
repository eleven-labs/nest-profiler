import { Injectable, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { HttpProfilerRecorder } from '@eleven-labs/nest-profiler-http';
import { ArticleGateway } from '../../domain/article-gateway.js';
import type {
  ExternalArticle,
  ExternalAuthor,
  ExternalTodo,
  NewArticle,
} from '../../domain/article.js';

const API_BASE = 'https://jsonplaceholder.typicode.com';

/**
 * Adapter for {@link ArticleGateway}. Most calls go through `@nestjs/axios`'s `HttpService` (captured
 * automatically by the axios collector); `fetchFirstArticleViaNativeFetch` demonstrates the
 * client-agnostic API by recording a plain `fetch` call with `HttpProfilerRecorder`.
 */
@Injectable()
export class AxiosArticleGateway implements ArticleGateway {
  constructor(
    private readonly http: HttpService,
    private readonly profiler: ProfilerService,
    // Optional so the gateway still works when the profiler (and thus the HTTP collector) is
    // disabled — recording then becomes a no-op.
    @Optional() private readonly recorder?: HttpProfilerRecorder,
  ) {}

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

  async fetchTodo(id: string): Promise<ExternalTodo> {
    const { data } = await firstValueFrom(this.http.get<ExternalTodo>(`${API_BASE}/todos/${id}`));
    return data;
  }

  async forwardArticle(article: NewArticle): Promise<unknown> {
    const { data } = await firstValueFrom(
      this.http.post<unknown>(`${API_BASE}/posts`, {
        title: article.title,
        body: article.body,
        userId: 1,
      }),
    );
    return data;
  }

  async fetchFirstArticleViaNativeFetch(): Promise<unknown> {
    const url = `${API_BASE}/posts/1`;
    const requestHeaders = { accept: 'application/json' };

    const startedAt = Date.now();
    const stop = this.profiler.startSpan('fetch.article');
    const response = await fetch(url, { headers: requestHeaders });
    const body: unknown = await response.json();
    stop();

    // `capture` applies the configured capture flags + header masking for us.
    this.recorder?.capture({
      method: 'GET',
      url,
      startedAt,
      duration: Date.now() - startedAt,
      statusCode: response.status,
      requestHeaders,
      responseHeaders: response.headers,
      responseBody: body,
    });

    return body;
  }
}
