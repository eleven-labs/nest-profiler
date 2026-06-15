import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Observable, from, of, throwError } from 'rxjs';
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

    // Adapters are idempotent (e.g. the GraphQL adapter enriches only the first
    // resolver of a request), so it is safe to call this unconditionally — the
    // core no longer needs to know which protocol field signals "already enriched".
    adapter.enrichProfile(activeProfile, ctx);

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
      this.core.schedulePersist(capturedProfile);
    });

    return next.handle().pipe(
      switchMap((body: unknown) => {
        this.finalize(capturedProfile, res, body);
        capturedProfile.route =
          this.core.routeCollector.match(req.method, req.path ?? req.url) ?? capturedProfile.route;
        this.core.enrichHttpResponse(capturedProfile, req, body);

        // The toolbar embeds collector panels, so HTML responses are the only ones that
        // must wait for the collectors before being sent.
        if (this.isToolbarEligible(res, body)) {
          return from(this.core.collectorRegistry.collectAll(capturedProfile)).pipe(
            map(() => {
              this.core.scheduleSave(capturedProfile);
              return this.injectToolbar(res, body, capturedProfile);
            }),
          );
        }

        // Everything else (JSON, GraphQL…) is emitted immediately; collectors and
        // storage run after the response, adding no latency to the call.
        this.core.schedulePersist(capturedProfile);
        return of(body);
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
        // Collectors still run (deferred) so pipes/guards data (e.g. validator) is
        // captured without delaying the error response behind them.
        this.core.schedulePersist(capturedProfile);
        return throwError(() => err);
      }),
    );
  }

  private processNonHttp(capturedProfile: Profile, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        this.finalize(capturedProfile, null, body);
        this.core.schedulePersist(capturedProfile);
        return body;
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
        this.core.schedulePersist(capturedProfile);
        return throwError(() => err);
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

  /** An HTML page the toolbar can be injected into — the only response that waits for collectors. */
  private isToolbarEligible(res: PlatformResponse | null, body: unknown): body is string {
    const contentType = res?.getHeader('content-type');
    return (
      typeof contentType === 'string' &&
      contentType.includes('text/html') &&
      typeof body === 'string' &&
      body.includes('</body>')
    );
  }

  private injectToolbar(res: PlatformResponse | null, body: unknown, profile: Profile): unknown {
    if (this.isToolbarEligible(res, body)) {
      const panels = this.core.collectorRegistry.buildPanels(profile);
      const toolbar = toolbarSnippet(profile.token, this.profilerPath, panels);
      return body.replace('</body>', `${toolbar}</body>`);
    }
    return body;
  }
}
