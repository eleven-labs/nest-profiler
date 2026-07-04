import type { ClsService } from 'nestjs-cls';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import type { HttpRequestEntry } from './http-request.interface';
import { HTTP_CLIENT_REQUESTS_KEY } from './http-request.interface';

/**
 * Low-level primitive for feeding the shared "HTTP Client" panel from any HTTP
 * client. Reads the active profile from the CLS store (`profiler.profile`) and
 * appends the entry under the collector's accumulation key.
 *
 * It is a no-op — never throwing — when called outside a CLS context or when no
 * profile is active, so it is safe to call unconditionally from interceptors /
 * hooks. Prefer injecting {@link HttpProfilerRecorder} in application code; this
 * primitive is exposed for adapters and advanced use.
 */
export function appendHttpRequestEntry(cls: ClsService | undefined, entry: HttpRequestEntry): void {
  try {
    const profile = cls?.get<Profile | undefined>('profiler.profile');
    if (profile) {
      appendCollectorEntry<HttpRequestEntry>(profile, HTTP_CLIENT_REQUESTS_KEY, entry);
    }
  } catch {
    // Outside a CLS context — nothing to record.
  }
}
