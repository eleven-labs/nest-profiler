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
import { PROFILER_BASE_PATH } from '../constants';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { ProfilerCoreService } from '../services/profiler-core.service';
import { readProfile, setProfileContext } from '../services/profiler-context';
import { resolveExceptionCaptureOptions, toExceptionEntry } from '../analysis/to-exception-entry';
import type { ExceptionCaptureOptions } from '../analysis/to-exception-entry';
import { finalizeHttpProfile, resolveHttpCaptureConfig } from '../utils/http-capture.util';
import type { HttpCaptureConfig } from '../utils/http-capture.util';
import { isCollectionDeferred, readTransportResponseBody } from '../utils/profile-runtime-state';
import type { Profile } from '../interfaces/profile.interface';
import { toolbarSnippet } from '../views/layout.view';

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

/** Status reported for a non-HTTP execution, which has no transport status of its own. */
const NON_HTTP_STATUS = 200;

/** The status a thrown error is served as: an `HttpException` carries its own, anything else 500. */
function statusOf(err: unknown): number {
  return err instanceof HttpException ? err.getStatus() : 500;
}

@Injectable()
export class ProfilerInterceptor implements NestInterceptor {
  private readonly profilerPath = PROFILER_BASE_PATH;
  private readonly exceptionCapture: ExceptionCaptureOptions;
  /**
   * The same resolved capture settings the middleware applies to the request, so a header or key
   * masked on the way in is not readable on the way out and both directions share one body cap.
   */
  private readonly capture: HttpCaptureConfig;

  constructor(
    private readonly cls: ClsService,
    private readonly core: ProfilerCoreService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
  ) {
    this.exceptionCapture = resolveExceptionCaptureOptions(options);
    this.capture = resolveHttpCaptureConfig(options);
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
    const deferToFinishHook = isCollectionDeferred(activeProfile);

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

    // No `finish` listener here: the middleware registered the one the profiler needs, and it
    // already covers the case this path cannot see (a framework answering without ever reaching
    // the interceptor). A second listener only had to guard itself against the first.
    return next.handle().pipe(
      switchMap((body: unknown) => {
        // What the handler emitted is not always what the client receives (`@Res()`), so the
        // profile records the resolved payload while the stream keeps forwarding `body` untouched.
        const responseBody = this.resolveResponseBody(capturedProfile, res, body);
        this.finalize(capturedProfile, res, res.statusCode, responseBody);
        capturedProfile.route =
          this.core.routeCollector.match(req.method, req.path ?? req.url) ?? capturedProfile.route;
        this.core.enrichHttpResponse(capturedProfile, req, responseBody);

        // The toolbar embeds collector panels, so HTML responses are the only ones that
        // must wait for the profile to be completed before being sent. `collect()` and not
        // `collectAll()`: the toolbar needs the tags and the trace too, and calling the registry
        // directly here used to skip both, leaving HTML responses without either.
        if (this.isToolbarEligible(res, body)) {
          return from(this.core.collect(capturedProfile)).pipe(
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
        capturedProfile.exceptions.push(toExceptionEntry(err, this.exceptionCapture));
        // Exception filters run after the observable chain, so `res.statusCode` still reads 200
        // here. The real status comes from the error: an HttpException carries its own, anything
        // else is a 500 (mirrors processNonHttp).
        this.finalize(capturedProfile, res, statusOf(err), undefined);
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
        this.finalize(capturedProfile, null, NON_HTTP_STATUS, body);
        this.core.schedulePersist(capturedProfile);
        return body;
      }),
      catchError((err: unknown) => {
        capturedProfile.exceptions.push(toExceptionEntry(err, this.exceptionCapture));
        // Deferred: leave finalize + persist to the finish hook (the exception is already on the
        // profile, so it is saved with everything else once the response completes).
        if (!deferToFinishHook) {
          this.finalize(capturedProfile, null, statusOf(err), undefined);
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
    return readTransportResponseBody(profile);
  }

  /**
   * Hands what only the interceptor knows — the transport headers, the payload the handler
   * emitted, the status derived from an exception — to the shared finalizer, which is the one
   * place `profile.response` is built.
   */
  private finalize(
    profile: Profile,
    res: PlatformResponse | null,
    statusCode: number,
    body: unknown,
  ): void {
    finalizeHttpProfile(
      profile,
      {
        statusCode,
        headers: res?.getHeaders(),
        body,
        // A non-HTTP context (GraphQL, microservices) has no transport payload of its own, so the
        // resolver's result is recorded whether or not `collectBody` is on.
        alwaysCaptureBody: res === null,
      },
      this.capture,
    );
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
