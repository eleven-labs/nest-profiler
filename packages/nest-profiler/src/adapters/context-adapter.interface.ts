import type { ExecutionContext } from '@nestjs/common';
import type { Profile } from '../interfaces/profile.interface';

export const PROFILER_CONTEXT_ADAPTERS = 'PROFILER_CONTEXT_ADAPTERS';

export interface IContextAdapter {
  readonly contextType: string;
  /** Recovers the profile created by the middleware for this non-HTTP context. Returns null if unable. */
  recoverProfile(ctx: ExecutionContext): Profile | null;
  /** Enriches the profile with protocol-specific metadata. */
  enrichProfile(profile: Profile, ctx: ExecutionContext): void;
  /** Optional. Called for every HTTP response; implement to enrich metadata or surface errors from the response body. */
  enrichHttpResponse?(profile: Profile, req: object, responseBody: unknown): void;
}
