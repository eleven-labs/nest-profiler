import type { ExternalUser, Reviewer } from '../../domain/reviewer.js';

/** Base URL of the external user directory, shared by both adapters. */
export const USER_DIRECTORY_BASE = 'https://jsonplaceholder.typicode.com';

/** Flattens the directory's nested user payload into the domain {@link Reviewer}. */
export function toReviewer(user: ExternalUser): Reviewer {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    company: user.company.name,
  };
}

/** `?id=1&id=2&…` — the directory's bulk filter, one call for every requested author. */
export function usersByIdQuery(ids: readonly number[]): string {
  const params = new URLSearchParams();
  for (const id of ids) params.append('id', String(id));
  return params.toString();
}
