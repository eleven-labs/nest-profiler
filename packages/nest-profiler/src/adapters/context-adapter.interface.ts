import type { ExecutionContext } from '@nestjs/common';
import type { Profile } from '../interfaces/profile.interface';

export const PROFILER_CONTEXT_ADAPTERS = 'PROFILER_CONTEXT_ADAPTERS';

export interface IContextAdapter {
  readonly contextType: string;
  /** Recovers the profile created by the middleware for this non-HTTP context. Returns null if unable. */
  recoverProfile(ctx: ExecutionContext): Profile | null;
  /** Enriches the profile with protocol-specific metadata. */
  enrichProfile(profile: Profile, ctx: ExecutionContext): void;
  /**
   * Optional hook called by ProfilerInterceptor for every HTTP response.
   * Adapters that handle protocols tunnelled over HTTP (e.g. GraphQL over POST)
   * can implement this to populate profile metadata and surface errors from the
   * response body — including cases where no resolver runs (schema validation failures).
   */
  enrichHttpResponse?(profile: Profile, req: Record<string, unknown>, responseBody: unknown): void;
}
