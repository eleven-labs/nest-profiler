import { Injectable } from '@nestjs/common';
import type { EventEntry, ExceptionEntry, SecurityContext } from '../interfaces/profile.interface';
import type { ProfilerService } from './nest-profiler.service';

/**
 * Zero-dependency no-op implementation of the {@link ProfilerService} public API.
 *
 * It is what backs `ProfilerService` when the profiler is disabled — both in
 * {@link ProfilerNoopModule} and in the core module's inert (`enabled: false`)
 * layer. Unlike the real service it injects **nothing** (no `ClsService`, no
 * core), so the disabled path costs nothing: no CLS store, no storage, no
 * collectors, and the async options factory is never run.
 *
 * `implements Pick<ProfilerService, …>` keeps every method signature in lockstep
 * with the real service, so the compiler flags any drift.
 */
@Injectable()
export class NoopProfilerService implements Pick<
  ProfilerService,
  'flush' | 'getCurrentToken' | 'addException' | 'addEvent' | 'setSecurityContext' | 'startSpan'
> {
  async flush(): Promise<void> {}

  getCurrentToken(): string | undefined {
    return undefined;
  }

  addException(_entry: ExceptionEntry): void {}

  addEvent(_entry: EventEntry): void {}

  setSecurityContext(_data: SecurityContext): void {}

  startSpan(_phase: string): () => void {
    return () => {};
  }
}
