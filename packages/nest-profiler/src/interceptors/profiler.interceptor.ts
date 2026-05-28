import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { from, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { ClsService } from 'nestjs-cls';
import type { PlatformRequest, PlatformResponse } from '../types/http';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { ProfilerCoreService } from '../services/profiler-core.service';
import type { Profile } from '../interfaces/profile.interface';
import { toolbarSnippet } from '../views/layout.view';

function normalizeHeaders(
  raw: Record<string, string | number | string[]>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]),
  );
}

@Injectable()
export class ProfilerInterceptor implements NestInterceptor {
  private readonly profilerPath: string;
  private readonly collectBody: boolean;

  constructor(
    private readonly cls: ClsService,
    private readonly core: ProfilerCoreService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
  ) {
    this.profilerPath = options.path ?? '/_profiler';
    this.collectBody = options.collectBody ?? false;
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    let profile: Profile | undefined;
    try {
      profile = this.cls.get<Profile | undefined>('profiler.profile');
    } catch {
      // Outside CLS context
    }

    if (!profile) return next.handle();

    const res = ctx.switchToHttp().getResponse<PlatformResponse>();
    const req = ctx.switchToHttp().getRequest<PlatformRequest>();
    const capturedProfile = profile;

    return next.handle().pipe(
      switchMap((body: unknown) => {
        this.finalize(capturedProfile, res, body);
        capturedProfile.route =
          this.core.routeCollector.match(req.method, req.path ?? req.url) ?? capturedProfile.route;
        return from(this.core.collectorRegistry.collectAll(capturedProfile)).pipe(
          tap(() => {
            void this.core.storage.save(capturedProfile);
          }),
          map(() => this.injectToolbar(res, body, capturedProfile)),
        );
      }),
      catchError((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        capturedProfile.exceptions.push({
          name: error.name,
          message: error.message,
          stack: error.stack,
          timestamp: Date.now(),
        });
        this.finalize(capturedProfile, res, undefined);
        // Exception filters run after the observable chain, so res.statusCode is still 200 here.
        // Read the real status directly from HttpException when available.
        if (err instanceof HttpException && capturedProfile.response) {
          capturedProfile.response.statusCode = err.getStatus();
        }
        capturedProfile.route =
          this.core.routeCollector.match(req.method, req.path ?? req.url) ?? capturedProfile.route;
        // Run collectors even on error paths so pipes/guards data (e.g. validator) is captured.
        return from(this.core.collectorRegistry.collectAll(capturedProfile)).pipe(
          tap(() => {
            void this.core.storage.save(capturedProfile);
          }),
          switchMap(() => throwError(() => err)),
        );
      }),
    );
  }

  private finalize(profile: Profile, res: PlatformResponse, body: unknown): void {
    profile.performance.duration = Date.now() - profile.performance.startTime;
    profile.response = {
      statusCode: res.statusCode,
      headers: normalizeHeaders(res.getHeaders()),
      body: this.collectBody ? body : undefined,
    };
  }

  private injectToolbar(res: PlatformResponse, body: unknown, profile: Profile): unknown {
    const contentType = res.getHeader('content-type');
    if (
      typeof contentType === 'string' &&
      contentType.includes('text/html') &&
      typeof body === 'string' &&
      body.includes('</body>')
    ) {
      const panels = this.core.collectorRegistry.buildPanels(profile);
      const toolbar = toolbarSnippet(profile.token, this.profilerPath, panels);
      return body.replace('</body>', `${toolbar}</body>`);
    }
    return body;
  }
}
