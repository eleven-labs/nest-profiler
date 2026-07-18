import { Injectable } from '@nestjs/common';
import type { CanActivate } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PROFILER_CLS_KEYS } from '../constants';
import { lifecycleMarks } from '../trace/build-lifecycle';
import type { Profile } from '../interfaces/profile.interface';
import { nowMs } from '../utils/clock';

/**
 * A no-op global guard that stamps, on the active profile, the epoch-ms at which the guard phase
 * began (first invocation per request wins). `buildLifecycle` later turns it into the `guards` bar.
 * Always returns `true`, so it never affects access control; a safe no-op outside a profiled request.
 */
@Injectable()
export class ProfilerLifecycleGuard implements CanActivate {
  constructor(private readonly cls: ClsService) {}

  canActivate(): boolean {
    try {
      const profile = this.cls.get<Profile | undefined>(PROFILER_CLS_KEYS.profile);
      if (profile) {
        const marks = lifecycleMarks(profile);
        marks.guardsAt ??= nowMs();
      }
    } catch {
      // Outside a CLS context — nothing to record.
    }
    return true;
  }
}
