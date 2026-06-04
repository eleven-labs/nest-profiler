import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type {
  EventEntry,
  ExceptionEntry,
  LogEntry,
  Profile,
  SecurityContext,
} from '../interfaces/profile.interface';
import { createProfilerLogger } from './profiler-logger-adapter';
import type { LogMethodMap } from './profiler-logger-adapter';

@Injectable()
export class ProfilerService {
  constructor(private readonly cls: ClsService) {}

  getCurrentToken(): string | undefined {
    try {
      return this.cls.get<string | undefined>('profiler.token');
    } catch {
      return undefined;
    }
  }

  private getProfile(): Profile | undefined {
    try {
      return this.cls.get<Profile | undefined>('profiler.profile');
    } catch {
      return undefined;
    }
  }

  addLog(entry: LogEntry): void {
    this.getProfile()?.logs.push(entry);
  }

  addException(entry: ExceptionEntry): void {
    this.getProfile()?.exceptions.push(entry);
  }

  addEvent(entry: EventEntry): void {
    const profile = this.getProfile();
    if (!profile) return;
    (profile.events ??= []).push(entry);
  }

  setSecurityContext(data: SecurityContext): void {
    const profile = this.getProfile();
    if (!profile) return;
    profile.security = data;
  }

  startSpan(phase: string): () => void {
    const startedAt = Date.now();
    return () => {
      const duration = Date.now() - startedAt;
      const profile = this.getProfile();
      if (!profile) return;
      (profile.spans ??= []).push({ phase, startedAt, duration });
    };
  }

  /** Wraps any logger transparently: captures log calls into the active profile while forwarding to the real logger. */
  createLogger<T extends object>(delegate: T, logMethods?: LogMethodMap): T {
    return createProfilerLogger(delegate, this, logMethods);
  }
}
