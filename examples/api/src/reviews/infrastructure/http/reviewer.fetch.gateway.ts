import { Injectable } from '@nestjs/common';
import { ReviewerGateway } from '../../domain/reviewer-gateway.js';
import type { ExternalUser, Reviewer } from '../../domain/reviewer.js';
import { USER_DIRECTORY_BASE, toReviewer, usersByIdQuery } from './reviewer.mapper.js';

/** Parses the body, rejecting anything the axios adapter's `validateStatus` would reject too. */
async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`User directory responded ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Native `fetch` adapter for {@link ReviewerGateway} — selected when `HTTP_CLIENT=fetch`. Drop-in
 * alternative to {@link AxiosReviewerGateway}: same directory, same behaviour (a missing author is
 * `null`, any other failure throws), but the calls are captured by `FetchInstrumentation` (which
 * patches `globalThis.fetch`, already installed by the content context) instead of the axios one.
 */
@Injectable()
export class FetchReviewerGateway implements ReviewerGateway {
  async fetchReviewer(id: number): Promise<Reviewer | null> {
    const response = await fetch(`${USER_DIRECTORY_BASE}/users/${id}`);
    if (response.status === 404) return null;
    return toReviewer(await readJson<ExternalUser>(response));
  }

  async fetchReviewers(ids: readonly number[]): Promise<Reviewer[]> {
    const response = await fetch(`${USER_DIRECTORY_BASE}/users?${usersByIdQuery(ids)}`);
    const users = await readJson<ExternalUser[]>(response);
    return users.map(toReviewer);
  }
}
