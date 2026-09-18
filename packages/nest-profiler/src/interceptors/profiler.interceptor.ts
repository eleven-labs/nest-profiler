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

/**
 * `SSE_METADATA`, `ROUTE_ARGS_METADATA` and `RESPONSE_PASSTHROUGH_METADATA` from
 * `@nestjs/common/constants`, copied rather than deep-imported.
 */
const SSE_HANDLER_METADATA = '__sse__';
const ROUTE_ARGS_METADATA = '__routeArguments__';
const RESPONSE_PASSTHROUGH_METADATA = '__responsePassthrough__';

/**
 * `RouteParamtypes.RESPONSE` and `.NEXT` — the two parameters that hand the response to the
 * handler. Route-argument metadata keys are `${paramtype}:${index}`.
 */
const RESPONSE_PARAM_TYPES = ['1', '2'];

/**
 * True when the route handler took the response over (`@Res()` / `@Next()` without `passthrough`),
 * which is exactly what NestJS itself checks to decide it must write nothing.
 *
 * It is what makes the streaming detection reliable rather than lucky: such a handler may start
 * writing long after it returned — an LLM answer piped to the response once the model replies —
 * and until it does, the response is indistinguishable from one simply not written yet. Its
 * profile therefore has to stay open until the transport is done with it.
 */
function handlesResponseItself(ctx: ExecutionContext): boolean {
  const controller = ctx.getClass();
  const method = ctx.getHandler().name;
  if (Reflect.getMetadata(RESPONSE_PASSTHROUGH_METADATA, controller, method) === true) return false;

  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
    Record<string, unknown> | undefined;
  if (args === undefined) return false;

  return Object.keys(args).some((key) => RESPONSE_PARAM_TYPES.includes(key.split(':')[0] ?? ''));
}

/**
 * True when the handler emitted a stream the framework has yet to drain — a `StreamableFile`, a
 * Node `Readable`, a web `ReadableStream`. Duck-typed so the core stays off `instanceof` against
 * the application's own `@nestjs/common` copy.
 */
function isStreamLike(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { getStream?: unknown; pipe?: unknown; getReader?: unknown };
  return (
    typeof candidate.getStream === 'function' ||
    typeof candidate.pipe === 'function' ||
    typeof candidate.getReader === 'function'
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

    // Re-establish CLS context so the profiler logger and TracerService work inside resolvers.
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

    // NestJS flattens an `@Sse()` handler's Observable into this chain, so a streamed response
    // emits once per chunk: the first emission decides, every later one is forwarded untouched.
    // Without the latch a thousand-token stream would collect and store its profile as many times.
    let settled = false;
    /** Set when the response-finish hook was left to own the finalization (see below). */
    let deferred = false;

    // No `finish` listener here: the middleware registered the one the profiler needs, and it
    // already covers the case this path cannot see (a framework answering without ever reaching
    // the interceptor). A second listener only had to guard itself against the first.
    return next.handle().pipe(
      switchMap((body: unknown) => {
        if (settled) return of(body);
        settled = true;

        // The finish hook can close the profile before this runs, when a handler awaits the
        // stream it is writing. Re-finalizing would run the collectors a second time.
        if (capturedProfile.response) return of(body);

        capturedProfile.route =
          this.core.routeCollector.match(req.method, req.path ?? req.url) ?? capturedProfile.route;

        // The response has only *started* — finalizing now would file the time it took to open
        // the stream as the request's duration and drain the collectors before it did any work.
        // The middleware's finish hook closes it when the transport is really done.
        if (isCollectionDeferred(capturedProfile) && this.isStreamedResponse(ctx, res, body)) {
          deferred = true;
          return of(body);
        }

        // What the handler emitted is not always what the client receives (`@Res()`), so the
        // profile records the resolved payload while the stream keeps forwarding `body` untouched.
        const responseBody = this.resolveResponseBody(capturedProfile, res, body);
        this.finalize(capturedProfile, res, res.statusCode, responseBody);
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
        capturedProfile.route =
          this.core.routeCollector.match(req.method, req.path ?? req.url) ?? capturedProfile.route;
        // A stream that failed mid-flight: the finish hook owns closing and saving the profile,
        // and the exception is already on it.
        if (deferred) return throwError(() => err);
        // Exception filters run after the observable chain, so `res.statusCode` still reads 200
        // here. The real status comes from the error: an HttpException carries its own, anything
        // else is a 500 (mirrors processNonHttp).
        this.finalize(capturedProfile, res, statusOf(err), undefined);
        // Collectors still run (deferred) so pipes/guards data (e.g. validator) is
        // captured without delaying the error response behind them.
        this.core.schedulePersist(capturedProfile);
        return throwError(() => err);
      }),
    );
  }

  /**
   * Whether the transport will still be writing once the handler's observable has completed.
   *
   * Four signals, none of which asks the application for anything: the `@Sse()` metadata on the
   * handler (the only reliable one there — an emission reaching this chain is an individual event,
   * and the SSE headers may not be out yet), a handler that took the response over and has not
   * ended it, headers already sent, and a stream object emitted by the handler.
   */
  private isStreamedResponse(ctx: ExecutionContext, res: PlatformResponse, body: unknown): boolean {
    const raw = res as unknown as { writableEnded?: boolean; headersSent?: boolean };
    // Already written in full — whatever it was, it is over.
    if (raw.writableEnded === true) return false;
    if (Reflect.getMetadata(SSE_HANDLER_METADATA, ctx.getHandler()) === true) return true;
    if (handlesResponseItself(ctx)) return true;
    if (raw.headersSent === true) return true;
    return isStreamLike(body);
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
