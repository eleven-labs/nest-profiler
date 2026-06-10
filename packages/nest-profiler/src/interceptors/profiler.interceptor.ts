import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
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
    const contextType = ctx.getType<string>();

    let profile: Profile | undefined;
    try {
      profile = this.cls.get<Profile | undefined>('profiler.profile');
    } catch {
      // Outside CLS context
    }

    // HTTP: profile is created by the middleware and always in CLS when present.
    if (contextType === 'http') {
      return profile ? this.processHttp(profile, ctx, next) : next.handle();
    }

    // Non-HTTP (GraphQL, etc.): find an adapter registered via ProfilerCoreService.
    const adapter = this.core.findContextAdapter(contextType);
    if (!adapter) return next.handle();

    // The profile may already be in CLS when the driver propagates the async context
    // correctly, or it must be recovered from req[PROFILER_REQ_KEY] otherwise.
    const activeProfile = profile ?? adapter.recoverProfile(ctx);
    if (!activeProfile) return next.handle();

    // Only enrich once — the first resolver in the request captures the operation info.
    if (!activeProfile.request.graphql) {
      adapter.enrichProfile(activeProfile, ctx);
    }

    if (profile) {
      // CLS already active — route directly to the non-HTTP pipeline.
      return this.processNonHttp(activeProfile, next);
    }

    // Re-establish CLS context so ProfilerService.addLog() works inside resolvers.
    return new Observable((subscriber) => {
      this.cls.run(() => {
        this.cls.set('profiler.profile', activeProfile);
        this.cls.set('profiler.token', activeProfile.token);
        this.processNonHttp(activeProfile, next).subscribe(subscriber);
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

    // Safety net: Apollo bypasses Express next() so the Observable never fires — rely on finish event.
    type FinishableResponse = {
      once?: (event: 'finish', fn: () => void) => void;
      statusCode?: number;
    };
    const rawRes = res as FinishableResponse;
    rawRes.once?.('finish', () => {
      if (capturedProfile.response) return; // normal path already ran
      capturedProfile.performance.duration = Date.now() - capturedProfile.performance.startTime;
      capturedProfile.response = {
        statusCode: rawRes.statusCode ?? 200,
        headers: {},
        body: undefined,
      };
      this.core.enrichHttpResponse(capturedProfile, req, undefined);
      void this.core.collectorRegistry
        .collectAll(capturedProfile)
        .then(() => this.core.storage.save(capturedProfile));
    });

    return next.handle().pipe(
      switchMap((body: unknown) => {
        this.finalize(capturedProfile, res, body);
        capturedProfile.route =
          this.core.routeCollector.match(req.method, req.path ?? req.url) ?? capturedProfile.route;
        this.core.enrichHttpResponse(capturedProfile, req, body);
        return this.collectAndSave(capturedProfile).pipe(
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
        return this.collectAndSave(capturedProfile).pipe(switchMap(() => throwError(() => err)));
      }),
    );
  }

  private processNonHttp(capturedProfile: Profile, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      switchMap((body: unknown) => {
        this.finalize(capturedProfile, null, body);
        return this.collectAndSave(capturedProfile).pipe(map(() => body));
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
        return this.collectAndSave(capturedProfile).pipe(switchMap(() => throwError(() => err)));
      }),
    );
  }

  private collectAndSave(profile: Profile): Observable<void> {
    return from(this.core.collectorRegistry.collectAll(profile)).pipe(
      switchMap(() => defer(() => Promise.resolve(this.core.storage.save(profile)))),
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
