import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ReviewerGateway } from '../../domain/reviewer-gateway.js';
import type { ExternalUser, Reviewer } from '../../domain/reviewer.js';
import { USER_DIRECTORY_BASE, toReviewer, usersByIdQuery } from './reviewer.mapper.js';

/**
 * axios adapter for {@link ReviewerGateway} — selected when `HTTP_CLIENT=axios` (the default). It
 * owns its own `HttpModule`, hence its own axios instance: `AxiosInstrumentation` discovers **every**
 * instance in the container, so these calls land in the same HTTP Client panel as the content
 * context's without this module registering a second collector.
 */
@Injectable()
export class AxiosReviewerGateway implements ReviewerGateway {
  constructor(private readonly http: HttpService) {}

  async fetchReviewer(id: number): Promise<Reviewer | null> {
    const { data, status } = await firstValueFrom(
      this.http.get<ExternalUser>(`${USER_DIRECTORY_BASE}/users/${id}`, {
        validateStatus: (code) => code === 200 || code === 404,
      }),
    );
    return status === 200 ? toReviewer(data) : null;
  }

  async fetchReviewers(ids: readonly number[]): Promise<Reviewer[]> {
    const { data } = await firstValueFrom(
      this.http.get<ExternalUser[]>(`${USER_DIRECTORY_BASE}/users?${usersByIdQuery(ids)}`),
    );
    return data.map(toReviewer);
  }
}
