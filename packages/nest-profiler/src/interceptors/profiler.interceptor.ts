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
import {
  PROFILER_BASE_PATH,
  PROFILER_DEFER_COLLECTION,
  PROFILER_RESPONSE_BODY,
} from '../constants';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { ProfilerCoreService } from '../services/profiler-core.service';
import { readProfile, setProfileContext } from '../services/profiler-context';
import { toExceptionEntry } from '../analysis/to-exception-entry';
import { completeProfilePerformance } from '../utils/profile-metrics.util';
import type { Profile } from '../interfaces/profile.interface';
import { toolbarSnippet } from '../views/layout.view';
import { DEFAULT_MAX_BODY_SIZE, normalizeBody } from '../utils/safe-data.utils';
import type { SafeDataOptions } from '../utils/safe-data.utils';

function normalizeHeaders(
  raw: Record<string, string | number | string[]>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]),
  );
}

/**
 * True when the value a route handler emitted is the transport response object rather than a
 * payload. This is the `@Res()` / `@Response()` pattern: `res.json(body)`, `res.send(body)`,
 * `res.status(code)` and `res.header(...)` all evaluate to the response itself (Express) or to the
 * reply (Fastify), so the handler returns the transport object and profiling it as the response
 * body would dump the whole socket/request graph into the profile.
 */
function isPlatformResponse(value: unknown, res: PlatformResponse | null): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (res && (value === res || value === (res as unknown as { raw?: unknown }).raw)) return true;
  const candidate = value as { end?: unknown; setHeader?: unknown; getHeaders?: unknown };
  return (
    typeof candidate.end === 'function' &&
    typeof candidate.setHeader === 'function' &&
    typeof candidate.getHeaders === 'function'
  );
}

@Injectable()
export class ProfilerInterceptor implements NestInterceptor {
  private readonly profilerPath = PROFILER_BASE_PATH;
  private readonly collectBody: boolean;
  private readonly maxBodySize: number | undefined;
  private readonly bodyCaptureLimits: SafeDataOptions | undefined;

  constructor(
    private readonly cls: ClsService,
    private readonly core: ProfilerCoreService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
  ) {
    this.collectBody = options.collectBody ?? false;
    this.maxBodySize = options.maxBodySize;
    this.bodyCaptureLimits = options.bodyCaptureLimits;
  }

  /** JSON-safe, size-bounded copy of a captured body (see `maxBodySize` / `bodyCaptureLimits`). */
  private normalizeBody(body: unknown): unknown {
    return normalizeBody(body, this.maxBodySize ?? DEFAULT_MAX_BODY_SIZE, this.bodyCaptureLimits);
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const contextType = ctx.getType<string>();

    const profile = readProfile(this.cls);

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

    // Re-establish CLS context so the profiler logger and ProfilerService work inside resolvers.
    return new Observable((subscriber) => {
      this.cls.run(() => {
        // Repose the transport request so request-scoped collectors (auth) can read
        // `req.user` on this recovered path instead of reporting the user as anonymous.
        setProfileContext(this.cls, activeProfile, adapter.getRequest?.(ctx));
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
      completeProfilePerformance(capturedProfile);
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
        // What the handler emitted is not always what the client receives (`@Res()`), so the
        // profile records the resolved payload while the stream keeps forwarding `body` untouched.
        const responseBody = this.resolveResponseBody(capturedProfile, res, body);
        this.finalize(capturedProfile, res, responseBody);
        capturedProfile.route =
          this.core.routeCollector.match(req.method, req.path ?? req.url) ?? capturedProfile.route;
        this.core.enrichHttpResponse(capturedProfile, req, responseBody);

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
        capturedProfile.exceptions.push(toExceptionEntry(err));
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
        capturedProfile.exceptions.push(toExceptionEntry(err));
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

  /**
   * Resolves the body actually sent to the client. When the handler emitted the transport response
   * itself (`@Res()`), falls back to the body the middleware captured off `res.json()` /
   * `res.send()`; when no such capture is available, the body is reported as absent rather than as
   * the transport object.
   */
  private resolveResponseBody(
    profile: Profile,
    res: PlatformResponse | null,
    body: unknown,
  ): unknown {
    if (!isPlatformResponse(body, res)) return body;
    const getCapturedBody = (profile as unknown as Record<symbol, unknown>)[PROFILER_RESPONSE_BODY];
    return typeof getCapturedBody === 'function' ? (getCapturedBody as () => unknown)() : undefined;
  }

  private finalize(profile: Profile, res: PlatformResponse | null, body: unknown): void {
    completeProfilePerformance(profile);
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
