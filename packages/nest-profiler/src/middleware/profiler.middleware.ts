import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable, Logger, NestMiddleware, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { NextFunction, PlatformRequest, PlatformResponse } from '../types/http';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';
import { HTTP_ENTRYPOINT_TYPE } from '../interfaces/profile.interface';
import {
  PROFILER_REQ_KEY,
  PROFILER_BASE_PATH,
  PROFILER_DEFER_COLLECTION,
  PROFILER_RESPONSE_BODY,
} from '../constants';
import { ProfilerCoreService } from '../services/profiler-core.service';
import { setProfileContext } from '../services/profiler-context';
import type {
  ProfilerFilterRequest,
  ProfilerForceProfileFilter,
  ProfilerRequestFilter,
} from '../filters';
import { completeProfilePerformance, markProfileStart } from '../utils/profile-metrics.util';
import { redactQueryRecord, redactQueryString } from '../utils/redact-query.util';
import { redact, REDACTED } from '../utils/redact.utils';
import type { RedactOptions } from '../utils/redact.utils';
import { resolveRedactionConfig } from '../utils/redaction-config';
import { DEFAULT_MAX_BODY_SIZE, normalizeBody } from '../utils/safe-data.utils';
import type { SafeDataOptions } from '../utils/safe-data.utils';
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

/**
 * Flattens incoming headers into a plain record, replacing the value of any header whose
 * (lower-cased) name is in `maskHeaders` with `[REDACTED]`. This masks credential-bearing
 * headers (`authorization`, the raw `cookie` header, `x-api-key`…) before they are ever
 * persisted or shown in the dashboard / "Copy as cURL".
 */
function normalizeIncomingHeaders(
  headers: IncomingHttpHeaders,
  maskHeaders: ReadonlySet<string>,
  replacement: string = REDACTED,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    result[k] = maskHeaders.has(k.toLowerCase()) ? replacement : v;
  }
  return result;
}

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

/** Shared empty mask set for calls that must not redact (the user's own skip predicate). */
const EMPTY_MASK: ReadonlySet<string> = new Set();

@Injectable()
export class ProfilerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ProfilerMiddleware.name);
  private readonly profilerPath = PROFILER_BASE_PATH;
  private readonly collectBody: boolean;
  private readonly maxBodySize: number | undefined;
  private readonly bodyCaptureLimits: SafeDataOptions | undefined;
  private readonly sampleRate: number;
  private readonly ignorePaths: (string | RegExp)[];
  private readonly maskCookies: ReadonlySet<string>;
  private readonly maskHeaders: ReadonlySet<string>;
  private readonly maskQueryParams: ReadonlySet<string>;
  private readonly redactOptions: RedactOptions;
  private readonly replacement: string;
  private readonly emitDebugHeaders: boolean;
  private readonly ignoreRequest: ProfilerRequestFilter | undefined;
  private readonly alwaysProfile: ProfilerForceProfileFilter | undefined;
  private readonly debug: boolean;
  private readonly attributesFn:
    ((req: ProfilerFilterRequest) => Record<string, SummaryPrimitive>) | undefined;

  constructor(
    private readonly cls: ClsService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
    // @Optional() — only available in the active (enabled) layer; null in the inert layer.
    @Optional() private readonly core: ProfilerCoreService,
  ) {
    this.collectBody = options.collectBody ?? false;
    this.maxBodySize = options.maxBodySize;
    this.bodyCaptureLimits = options.bodyCaptureLimits;
    this.sampleRate = options.sampleRate ?? 1.0;
    this.ignorePaths = [
      ...(options.useDefaultIgnorePaths === false ? [] : DEFAULT_IGNORE_PATHS),
      ...(options.ignorePaths ?? []),
    ];
    // Additive merge of `redaction` and the deprecated flat options, resolved once in the shared
    // helper the interceptor also uses so request and response capture never mask differently.
    const redaction = resolveRedactionConfig(options);
    this.maskCookies = redaction.maskCookies;
    this.maskHeaders = redaction.maskHeaders;
    this.maskQueryParams = redaction.maskQueryParams;
    this.redactOptions = redaction.redactOptions;
    this.replacement = redaction.replacement;
    this.emitDebugHeaders = options.emitDebugHeaders ?? true;
    this.ignoreRequest = options.ignoreRequest;
    this.alwaysProfile = options.alwaysProfile;
    this.debug = options.debug ?? false;
    this.attributesFn = typeof options.attributes === 'function' ? options.attributes : undefined;
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
    const rawRequestId = req.headers['x-request-id'];
    const requestId = Array.isArray(rawRequestId) ? rawRequestId[0] : rawRequestId;

    const profile: Profile<HttpRequestData> = {
      token,
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
            this.maskQueryParams,
            this.replacement,
          ),
          headers: normalizeIncomingHeaders(req.headers, this.maskHeaders, this.replacement),
          query: redactQueryRecord(req.query ?? {}, this.maskQueryParams, this.replacement),
          ip: req.ip,
          requestId,
          body: this.collectBody ? this.normalizeBody(req.body) : undefined,
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
   * Attaches a response finish listener as a safety net for frameworks (e.g. Apollo
   * Server) that handle the response directly without calling Express's next() callback.
   * In those cases NestJS interceptors never run and the profile would otherwise be lost.
   *
   * The hook also intercepts `res.json()` so it can capture the response body before it
   * is sent — needed to surface GraphQL-level errors as exceptions.
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
    (profile as unknown as Record<symbol, unknown>)[PROFILER_DEFER_COLLECTION] = true;

    const getResponseBody = this.interceptResponseBody(rawRes, profile);

    // Published on the profile so the interceptor can read the body the transport wrote instead
    // of the value the route handler emitted — they differ under `@Res()` (see the symbol's doc).
    (profile as unknown as Record<symbol, unknown>)[PROFILER_RESPONSE_BODY] = getResponseBody;

    rawRes.once('finish', () => {
      const interceptedResponseBody = getResponseBody();
      if (profile.response) {
        // The interceptor already finalized, but two cases still need the body the transport
        // wrote afterwards: GraphQL (the resolver context never saw the { data, errors }
        // envelope) and any response whose body was produced after the observable completed —
        // an exception filter, or a handler that writes asynchronously (`res.render()`).
        const isGraphql = Boolean(profile.entrypoint.data.graphql);
        const needsBodyBackfill = this.collectBody && profile.response.body === undefined;
        if ((isGraphql || needsBodyBackfill) && interceptedResponseBody !== undefined) {
          profile.response.body = this.normalizeBody(interceptedResponseBody);
          if (isGraphql) {
            profile.response.statusCode = rawRes.statusCode ?? profile.response.statusCode;
          }
          this.core.scheduleSave(profile);
        }
        return;
      }

      completeProfilePerformance(profile);
      profile.response = {
        statusCode: rawRes.statusCode ?? 200,
        headers: {},
        body: this.collectBody ? this.normalizeBody(interceptedResponseBody) : undefined,
      };

      this.core.enrichHttpResponse(profile, req, interceptedResponseBody);

      this.core.schedulePersist(profile);
    });
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
      if (!this.collectBody && !profile.entrypoint.data.graphql) return false;
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

  /**
   * JSON-safe, size-bounded, redacted copy of a captured body (see `maxBodySize` /
   * `bodyCaptureLimits` / `redaction`). Bounded first, then redacted: the caps have already
   * dropped everything that will not be stored, so masking only walks what reaches the profile.
   */
  private normalizeBody(body: unknown): unknown {
    const safe = normalizeBody(
      body,
      this.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
      this.bodyCaptureLimits,
    );
    return redact(safe, this.redactOptions);
  }

  private buildCookieMap(req: PlatformRequest): Record<string, string> | undefined {
    const raw = req.cookies ?? this.parseCookies(req.headers.cookie);
    if (Object.keys(raw).length === 0) return undefined;
    return Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, this.maskCookies.has(k) ? this.replacement : v]),
    );
  }

  private buildSessionData(req: PlatformRequest): Record<string, unknown> | undefined {
    if (!req.session) return undefined;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.session)) {
      if (typeof v !== 'function') data[k] = v;
    }
    // Session data commonly holds tokens/passport payloads — redact sensitive keys/values.
    return Object.keys(data).length > 0 ? redact(data, this.redactOptions) : undefined;
  }

  /** Framework-agnostic request shape passed to `ignoreRequest`/`alwaysProfile`/`attributes`. */
  private toFilterRequest(req: PlatformRequest): ProfilerFilterRequest {
    return {
      method: req.method,
      url: req.url,
      path: req.path,
      // These predicates see raw headers (never persisted) so they can inspect e.g.
      // `authorization` to decide what to profile / tag.
      headers: normalizeIncomingHeaders(req.headers, EMPTY_MASK),
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
