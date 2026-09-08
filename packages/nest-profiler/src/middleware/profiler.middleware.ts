import { Inject, Injectable, Logger, NestMiddleware, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { NextFunction, PlatformRequest, PlatformResponse } from '../types/http';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';
import { HTTP_ENTRYPOINT_TYPE } from '../interfaces/profile.interface';
import { PROFILER_REQ_KEY, PROFILER_BASE_PATH } from '../constants';
import { ProfilerCoreService } from '../services/profiler-core.service';
import { setProfileContext } from '../services/profiler-context';
import type {
  ProfilerFilterRequest,
  ProfilerForceProfileFilter,
  ProfilerRequestFilter,
} from '../filters';
import { markProfileStart } from '../utils/profile-metrics.util';
import {
  captureBody,
  captureHeaders,
  finalizeHttpProfile,
  resolveHttpCaptureConfig,
} from '../utils/http-capture.util';
import type { HttpCaptureConfig } from '../utils/http-capture.util';
import {
  deferCollectionToFinishHook,
  setTransportResponseBody,
} from '../utils/profile-runtime-state';
import { redactQueryRecord, redactQueryString } from '../utils/redact-query.util';
import { extractHeaders } from '../utils/redact-headers.util';
import { redact } from '../utils/redact.utils';
import { DEFAULT_TRACE_ID_HEADER, resolveTraceId } from '../trace/trace-id';
import type { SummaryPrimitive } from '../storage/profile-summary';

/**
 * Paths skipped by default so the profiler list is not flooded with browser and
 * tooling noise that is never interesting to profile. Merged ahead of the
 * user's `ignorePaths`; opt out entirely with `useDefaultIgnorePaths: false`.
 */
export const DEFAULT_IGNORE_PATHS: (string | RegExp)[] = [
  '/favicon.ico',
  '/robots.txt',
  '/.well-known/appspecific/com.chrome.devtools.json',
  /^\/apple-touch-icon/,
];

/** Shape of the raw Node.js / Express response used for lifecycle hooks. */
type RawResponse = {
  once?: (event: 'finish', fn: () => void) => void;
  statusCode?: number;
  json?: (body: unknown) => unknown;
  send?: (body: unknown) => unknown;
  write?: (...args: unknown[]) => unknown;
  end?: (...args: unknown[]) => unknown;
  getHeader?: (name: string) => unknown;
};

/**
 * Upper bound on raw response chunks buffered to recover a body (the Mercurius/Fastify
 * write()+end() path). A GraphQL envelope is tiny; anything larger is almost certainly a
 * bulk JSON payload we have no reason to hold in memory, so buffering is abandoned past it.
 */
const MAX_BUFFERED_BODY_BYTES = 1024 * 1024;

@Injectable()
export class ProfilerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ProfilerMiddleware.name);
  private readonly profilerPath = PROFILER_BASE_PATH;
  /**
   * Body bounds and masking, resolved once through the shared helper the interceptor also uses,
   * so request and response capture can never bound or mask differently.
   */
  private readonly capture: HttpCaptureConfig;
  private readonly sampleRate: number;
  private readonly ignorePaths: (string | RegExp)[];
  private readonly emitDebugHeaders: boolean;
  private readonly ignoreRequest: ProfilerRequestFilter | undefined;
  private readonly alwaysProfile: ProfilerForceProfileFilter | undefined;
  private readonly debug: boolean;
  private readonly attributesFn:
    ((req: ProfilerFilterRequest) => Record<string, SummaryPrimitive>) | undefined;
  /** Lower-cased header the inbound trace id is adopted from. */
  private readonly traceIdHeader: string;

  constructor(
    private readonly cls: ClsService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
    // @Optional() — only available in the active (enabled) layer; null in the inert layer.
    @Optional() private readonly core: ProfilerCoreService,
  ) {
    this.capture = resolveHttpCaptureConfig(options);
    this.sampleRate = options.sampleRate ?? 1.0;
    this.ignorePaths = [
      ...(options.useDefaultIgnorePaths === false ? [] : DEFAULT_IGNORE_PATHS),
      ...(options.ignorePaths ?? []),
    ];
    this.emitDebugHeaders = options.emitDebugHeaders ?? true;
    this.ignoreRequest = options.ignoreRequest;
    this.alwaysProfile = options.alwaysProfile;
    this.debug = options.debug ?? false;
    this.attributesFn = typeof options.attributes === 'function' ? options.attributes : undefined;
    this.traceIdHeader = (options.traceIdHeader ?? DEFAULT_TRACE_ID_HEADER).toLowerCase();
  }

  use(req: PlatformRequest, res: PlatformResponse, next: NextFunction): void {
    if (this.shouldSkip(req)) {
      next();
      return;
    }

    // The storage token is ALWAYS an internal UUID — never derived from the client-controlled
    // `x-request-id` header. Deriving it from the header allowed path traversal on write
    // (`x-request-id: ../../evil`) and token collisions between concurrent requests sharing an
    // id. The header is kept only as a display-only correlation attribute.
    const token = crypto.randomUUID();
    // One clock reading for the whole profile: `createdAt` and `startTime` name the same
    // instant, and two separate calls let them disagree by a millisecond for no reason.
    const startTime = Date.now();
    // Correlation id, kept strictly apart from the token above: it *is* allowed to come from the
    // caller, so it is validated rather than trusted (see `resolveTraceId`), and it never
    // addresses storage.
    const traceId = resolveTraceId(req.headers[this.traceIdHeader]);

    const profile: Profile<HttpRequestData> = {
      token,
      traceId,
      createdAt: startTime,
      entrypoint: {
        type: HTTP_ENTRYPOINT_TYPE,
        data: {
          method: req.method,
          // Redacted here, at capture: the URL is persisted, rendered, exported by
          // `/:token/data` and copied into the cURL command, so a credential that reaches
          // the profile is readable everywhere the profile is.
          url: redactQueryString(
            req.originalUrl ?? req.url,
            this.capture.redaction.maskQueryParams,
            this.capture.redaction.replacement,
          ),
          headers: captureHeaders(req.headers, this.capture),
          query: redactQueryRecord(
            req.query ?? {},
            this.capture.redaction.maskQueryParams,
            this.capture.redaction.replacement,
          ),
          ip: req.ip,
          body: this.capture.collectBody ? captureBody(req.body, this.capture) : undefined,
          cookies: this.buildCookieMap(req),
          session: this.buildSessionData(req),
        },
      },
      performance: {
        startTime,
        heapUsed: process.memoryUsage().heapUsed,
      },
      logs: [],
      exceptions: [],
      collectors: {},
      attributes: this.attributesFn?.(this.toFilterRequest(req)),
    };

    // Durations are measured against this, not against `startTime` — see clock.utils.
    markProfileStart(profile);

    (req as unknown as Record<symbol, unknown>)[PROFILER_REQ_KEY] = profile;

    this.cls.run(() => {
      setProfileContext(this.cls, profile, req);
      if (this.emitDebugHeaders) {
        res.setHeader('X-Debug-Token', token);
        res.setHeader('X-Debug-Token-Link', `${this.profilerPath}/${token}`);
      }

      this.attachFinishHook(profile, req, res);
      next();
    });
  }

  /**
   * Attaches **the** response finish listener — the profiler registers exactly one, here.
   *
   * It plays two roles. As a safety net, it closes a profile the interceptor never got to:
   * frameworks that handle the response themselves (Apollo Server) bypass Express's `next()`,
   * so NestJS interceptors never run and the profile would otherwise be lost. And as the last
   * word on the response body, it intercepts `res.json()` / `res.send()` / `res.write()` so a
   * payload written after the observable completed — a GraphQL `{ data, errors }` envelope, an
   * exception filter's output, an async `res.render()` — still reaches the profile.
   */
  private attachFinishHook(
    profile: Profile<HttpRequestData>,
    req: PlatformRequest,
    res: PlatformResponse,
  ): void {
    if (!this.core) return; // only active in the enabled layer
    const rawRes = res as unknown as RawResponse;
    if (!rawRes.once) return;

    // A finish listener is guaranteed to run: let the non-HTTP (GraphQL) interceptor path defer
    // collection to it, so queries issued in field resolvers — which execute after the root
    // resolver returns — are still drained into their panels.
    deferCollectionToFinishHook(profile);

    const getResponseBody = this.interceptResponseBody(rawRes, profile);

    // Published for the interceptor, which needs the body the transport wrote rather than the
    // value the route handler emitted — they differ under `@Res()`.
    setTransportResponseBody(profile, getResponseBody);

    rawRes.once('finish', () => {
      const transportBody = getResponseBody();
      if (profile.response) {
        this.backfillResponseBody(profile, rawRes, transportBody);
        return;
      }

      // The interceptor never ran: this hook owns the whole finalization. Transport headers are
      // left out — this path exists precisely because the framework wrote the response itself.
      finalizeHttpProfile(
        profile,
        { statusCode: rawRes.statusCode ?? 200, body: transportBody },
        this.capture,
      );
      this.core.enrichHttpResponse(profile, req, transportBody);
      this.core.schedulePersist(profile);
    });
  }

  /**
   * Completes an already-finalized profile with the body the transport wrote afterwards, and
   * re-saves it when it changed.
   *
   * Two cases need it: GraphQL, whose resolver context never saw the `{ data, errors }` envelope
   * the driver sent (and whose real status is only known now), and any response whose body was
   * produced after the observable completed — an exception filter, or a handler writing
   * asynchronously (`res.render()`).
   */
  private backfillResponseBody(
    profile: Profile<HttpRequestData>,
    rawRes: RawResponse,
    transportBody: unknown,
  ): void {
    const response = profile.response;
    if (!response || transportBody === undefined) return;

    const isGraphql = Boolean(profile.entrypoint.data.graphql);
    const needsBody = this.capture.collectBody && response.body === undefined;
    if (!isGraphql && !needsBody) return;

    response.body = captureBody(transportBody, this.capture);
    if (isGraphql) response.statusCode = rawRes.statusCode ?? response.statusCode;
    this.core.scheduleSave(profile);
  }

  /**
   * Wraps the response's write methods so the body can be read back after it is sent, then
   * returns a getter for the parsed body (`undefined` when nothing JSON-shaped was captured).
   *
   * GraphQL drivers write their `{ data, errors }` envelope straight to the transport, but
   * via different methods: Apollo (Express) uses `res.json()`/`res.send()`, while Mercurius
   * (Fastify, through `@fastify/middie`) writes the raw Node response with `res.write(chunk…)`
   * followed by an empty `res.end()`. Raw chunks are only buffered when the body will actually
   * be consumed (body collection enabled, or a GraphQL request whose envelope we always
   * surface), are restricted to JSON responses, and are capped to bound memory.
   */
  private interceptResponseBody(
    rawRes: RawResponse,
    profile: Profile<HttpRequestData>,
  ): () => unknown {
    let body: unknown;
    const capture = (value: unknown): void => {
      if (body !== undefined || value === undefined || value === null) return;
      const raw = Buffer.isBuffer(value) ? value.toString('utf8') : value;
      try {
        body = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
      } catch {
        body = raw;
      }
    };

    const originalJson = rawRes.json?.bind(rawRes);
    if (originalJson) {
      rawRes.json = (value: unknown): unknown => {
        capture(value);
        return originalJson(value);
      };
    }

    const originalSend = rawRes.send?.bind(rawRes);
    if (originalSend) {
      rawRes.send = (value: unknown): unknown => {
        capture(value);
        return originalSend(value);
      };
    }

    // Raw-response fallback (Mercurius/Fastify): accumulate JSON chunks until end().
    let chunks: Buffer[] | undefined;
    let bufferedBytes = 0;
    let overflow = false;
    const shouldBuffer = (): boolean => {
      if (!this.capture.collectBody && !profile.entrypoint.data.graphql) return false;
      const contentType = rawRes.getHeader?.('content-type');
      return typeof contentType === 'string' && contentType.includes('json');
    };

    const originalWrite = rawRes.write?.bind(rawRes);
    if (originalWrite) {
      rawRes.write = (...args: unknown[]): unknown => {
        const chunk = args[0];
        if (!overflow && (typeof chunk === 'string' || Buffer.isBuffer(chunk)) && shouldBuffer()) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bufferedBytes += buf.length;
          if (bufferedBytes > MAX_BUFFERED_BODY_BYTES) {
            overflow = true;
            chunks = undefined; // give up — too large to be a GraphQL envelope
          } else {
            (chunks ??= []).push(buf);
          }
        }
        return originalWrite(...args);
      };
    }

    // end() may receive (chunk, encoding, cb) — only the first positional arg is a body.
    // Forward every argument untouched to preserve behaviour; fall back to the buffered
    // chunks when end() carries no body of its own (the Mercurius/Fastify path).
    const originalEnd = rawRes.end?.bind(rawRes);
    if (originalEnd) {
      rawRes.end = (...args: unknown[]): unknown => {
        const chunk = typeof args[0] === 'function' ? undefined : args[0];
        if (chunk !== undefined && chunk !== null) {
          capture(chunk);
        } else if (chunks?.length) {
          capture(Buffer.concat(chunks));
        }
        return originalEnd(...args);
      };
    }

    return () => body;
  }

  private shouldSkip(req: PlatformRequest): boolean {
    const reqPath = req.path ?? req.url;
    if (reqPath.startsWith(this.profilerPath)) {
      this.logSkip(() => `the profiler's own route ${reqPath}`);
      return true;
    }

    if (this.ignoreRequest?.(this.toFilterRequest(req))) {
      this.logSkip(() => `ignoreRequest matched ${req.method} ${reqPath}`);
      return true;
    }

    if (this.ignorePaths.length > 0) {
      const matched = this.ignorePaths.find((p) =>
        typeof p === 'string' ? reqPath.startsWith(p) : p.test(reqPath),
      );
      if (matched !== undefined) {
        this.logSkip(() => `ignorePaths matched ${String(matched)} for ${reqPath}`);
        return true;
      }
    }

    // Forces capture past the sample-rate roll below — but never past the hard stops above.
    if (this.alwaysProfile?.(this.toFilterRequest(req))) return false;

    if (this.sampleRate < 1.0 && Math.random() > this.sampleRate) {
      this.logSkip(() => `sampleRate (${this.sampleRate}) excluded ${req.method} ${reqPath}`);
      return true;
    }

    return false;
  }

  /** Logs why a request was skipped, only when `debug` is enabled — avoids the cost otherwise. */
  private logSkip(reason: () => string): void {
    if (this.debug) this.logger.debug(`Skipping profiling: ${reason()}`);
  }

  private buildCookieMap(req: PlatformRequest): Record<string, string> | undefined {
    const raw = req.cookies ?? this.parseCookies(req.headers.cookie);
    if (Object.keys(raw).length === 0) return undefined;
    const { maskCookies, replacement } = this.capture.redaction;
    return Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, maskCookies.has(k) ? replacement : v]),
    );
  }

  private buildSessionData(req: PlatformRequest): Record<string, unknown> | undefined {
    if (!req.session) return undefined;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.session)) {
      if (typeof v !== 'function') data[k] = v;
    }
    // Session data commonly holds tokens/passport payloads — redact sensitive keys/values.
    return Object.keys(data).length > 0
      ? redact(data, this.capture.redaction.redactOptions)
      : undefined;
  }

  /** Framework-agnostic request shape passed to `ignoreRequest`/`alwaysProfile`/`attributes`. */
  private toFilterRequest(req: PlatformRequest): ProfilerFilterRequest {
    return {
      method: req.method,
      url: req.url,
      path: req.path,
      // These predicates see raw headers (never persisted) so they can inspect e.g.
      // `authorization` to decide what to profile / tag — hence no mask list.
      headers: extractHeaders(req.headers, [], { multiValue: true }),
      body: req.body,
    };
  }

  private parseCookies(header?: string): Record<string, string> {
    if (!header) return {};
    const result: Record<string, string> = {};
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      try {
        result[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(
          part.slice(idx + 1).trim(),
        );
      } catch {
        // malformed cookie value — skip
      }
    }
    return result;
  }
}
