import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { ClsService } from 'nestjs-cls';
import type { PlatformRequest, PlatformResponse } from '../types/http';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { ProfilerCoreService } from '../services/profiler-core.service';
import type { Profile } from '../interfaces/profile.interface';
import { toolbarSnippet } from '../views/layout.view';
import { PROFILER_CONTEXT_ADAPTERS } from '../adapters/context-adapter.interface';
import type { IContextAdapter } from '../adapters/context-adapter.interface';

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
  private readonly adapters: IContextAdapter[];

  constructor(
    private readonly cls: ClsService,
    private readonly core: ProfilerCoreService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
    @Optional()
    @Inject(PROFILER_CONTEXT_ADAPTERS)
    adapters: IContextAdapter | IContextAdapter[] | null = null,
  ) {
    this.profilerPath = options.path ?? '/_profiler';
    this.collectBody = options.collectBody ?? false;
    this.adapters = adapters ? (Array.isArray(adapters) ? adapters : [adapters]) : [];
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    let profile: Profile | undefined;
    try {
      profile = this.cls.get<Profile | undefined>('profiler.profile');
    } catch {
      // Outside CLS context
    }

    if (profile) {
      return this.processHttp(profile, ctx, next);
    }

    if (ctx.getType<string>() === 'http') {
      return next.handle();
    }

    const contextType = ctx.getType<string>();
    const adapter = this.adapters.find((a) => a.contextType === contextType);
    if (!adapter) return next.handle();

    const recovered = adapter.recoverProfile(ctx);
    if (!recovered) return next.handle();

    adapter.enrichProfile(recovered, ctx);

    // Re-establish CLS context so ProfilerService.addLog() works inside resolvers
    return new Observable((subscriber) => {
      this.cls.run(() => {
        this.cls.set('profiler.profile', recovered);
        this.cls.set('profiler.token', recovered.token);
        this.processNonHttp(recovered, next).subscribe(subscriber);
      });
    });
  }

  private processHttp(
    capturedProfile: Profile,
    ctx: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const httpCtx = ctx.switchToHttp();
    const res = httpCtx.getResponse<PlatformResponse>();
    const req = httpCtx.getRequest<PlatformRequest>();

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
        if (capturedProfile.response && err instanceof HttpException) {
          // Exception filters run after the observable chain, so res.statusCode is still 200
          // here. Read the real status directly from HttpException when available.
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

  private processNonHttp(capturedProfile: Profile, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      switchMap((body: unknown) => {
        this.finalize(capturedProfile, null, body);
        return from(this.core.collectorRegistry.collectAll(capturedProfile)).pipe(
          tap(() => {
            void this.core.storage.save(capturedProfile);
          }),
          map(() => body),
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
        this.finalize(capturedProfile, null, undefined);
        if (capturedProfile.response) {
          capturedProfile.response.statusCode =
            err instanceof HttpException ? err.getStatus() : 500;
        }
        return from(this.core.collectorRegistry.collectAll(capturedProfile)).pipe(
          tap(() => {
            void this.core.storage.save(capturedProfile);
          }),
          switchMap(() => throwError(() => err)),
        );
      }),
    );
  }

  private finalize(profile: Profile, res: PlatformResponse | null, body: unknown): void {
    profile.performance.duration = Date.now() - profile.performance.startTime;
    if (res) {
      profile.response = {
        statusCode: res.statusCode,
        headers: normalizeHeaders(res.getHeaders()),
        body: this.collectBody ? body : undefined,
      };
    } else {
      // Non-HTTP context (GraphQL, microservices): always capture resolver result as body.
      profile.response = {
        statusCode: 200,
        headers: {},
        body,
      };
    }
  }

  private injectToolbar(res: PlatformResponse | null, body: unknown, profile: Profile): unknown {
    const contentType = res?.getHeader('content-type');
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
