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
import { PROFILER_BASE_PATH, PROFILER_DEFER_COLLECTION } from '../constants';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { ProfilerCoreService } from '../services/profiler-core.service';
import type { Profile } from '../interfaces/profile.interface';
import { toolbarSnippet } from '../views/layout.view';
import { normalizeBody } from '../utils/safe-data.utils';

function normalizeHeaders(
  raw: Record<string, string | number | string[]>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]),
  );
}

@Injectable()
export class ProfilerInterceptor implements NestInterceptor {
  private readonly profilerPath = PROFILER_BASE_PATH;
  private readonly collectBody: boolean;
  private readonly maxBodySize: number | undefined;

  constructor(
    private readonly cls: ClsService,
    private readonly core: ProfilerCoreService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
  ) {
    this.collectBody = options.collectBody ?? false;
    this.maxBodySize = options.maxBodySize;
  }

  /** JSON-safe, size-bounded copy of a captured body (see `maxBodySize`). */
  private normalizeBody(body: unknown): unknown {
    return this.maxBodySize === undefined
      ? normalizeBody(body)
      : normalizeBody(body, this.maxBodySize);
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

    // When the HTTP middleware registered a finish listener (marked on the profile), defer
    // collection to it: it fires after graphql-js has run every field resolver, so queries issued
    // there — which happen after the root resolver returns — are still drained into their panels.
    const deferToFinishHook =
      (activeProfile as unknown as Record<symbol, unknown>)[PROFILER_DEFER_COLLECTION] === true;

    if (profile) {
      // CLS already active — route directly to the non-HTTP pipeline.
      return this.processNonHttp(activeProfile, next, deferToFinishHook);
    }

    // Re-establish CLS context so ProfilerService.addLog() works inside resolvers.
    return new Observable((subscriber) => {
      this.cls.run(() => {
        this.cls.set('profiler.profile', activeProfile);
        this.cls.set('profiler.token', activeProfile.token);
        // Repose the transport request so request-scoped collectors (auth) can read
        // `req.user` on this recovered path instead of reporting the user as anonymous.
        const recoveredReq = adapter.getRequest?.(ctx);
        if (recoveredReq) this.cls.set('profiler.request', recoveredReq);
        this.processNonHttp(activeProfile, next, deferToFinishHook).subscribe(subscriber);
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
        if (capturedProfile.response) {
          // Exception filters run after the observable chain, so res.statusCode is still 200
          // here. Derive the real status from the error: an HttpException carries its own,
          // anything else becomes a 500 (mirrors processNonHttp).
          capturedProfile.response.statusCode =
            err instanceof HttpException ? err.getStatus() : 500;
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

  private processNonHttp(
    capturedProfile: Profile,
    next: CallHandler,
    deferToFinishHook: boolean,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        // Deferred: the HTTP finish hook finalizes and collects after every field resolver, so
        // draining here (when the root resolver returns) would miss field-resolver queries.
        if (deferToFinishHook) return body;
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
        // Deferred: leave finalize + persist to the finish hook (the exception is already on the
        // profile, so it is saved with everything else once the response completes).
        if (!deferToFinishHook) {
          this.finalize(capturedProfile, null, undefined);
          if (capturedProfile.response) {
            capturedProfile.response.statusCode =
              err instanceof HttpException ? err.getStatus() : 500;
          }
          this.core.schedulePersist(capturedProfile);
        }
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
        body: this.collectBody ? this.normalizeBody(body) : undefined,
      };
    } else {
      // Non-HTTP context (GraphQL, microservices): always capture resolver result as body.
      profile.response = {
        statusCode: 200,
        headers: {},
        body: this.normalizeBody(body),
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
