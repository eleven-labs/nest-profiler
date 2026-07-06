import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { NextFunction, PlatformRequest, PlatformResponse } from '../types/http';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';
import { HTTP_ENTRYPOINT_TYPE } from '../interfaces/profile.interface';
import { PROFILER_REQ_KEY, PROFILER_BASE_PATH, PROFILER_CLS_KEYS } from '../constants';
import { ProfilerCoreService } from '../services/profiler-core.service';
import type { ProfilerRequestFilter } from '../filters';
import { DEFAULT_MASK_HEADERS } from '../utils/redact-headers.util';
import { redact } from '../utils/redact.utils';
import { normalizeBody } from '../utils/safe-data.utils';

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
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    result[k] = maskHeaders.has(k.toLowerCase()) ? '[REDACTED]' : v;
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
  private readonly profilerPath = PROFILER_BASE_PATH;
  private readonly collectBody: boolean;
  private readonly maxBodySize: number | undefined;
  private readonly sampleRate: number;
  private readonly ignorePaths: (string | RegExp)[];
  private readonly maskCookies: Set<string>;
  private readonly maskHeaders: ReadonlySet<string>;
  private readonly emitDebugHeaders: boolean;
  private readonly ignoreRequest: ProfilerRequestFilter | undefined;

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
    this.sampleRate = options.sampleRate ?? 1.0;
    this.ignorePaths = [
      ...(options.useDefaultIgnorePaths === false ? [] : DEFAULT_IGNORE_PATHS),
      ...(options.ignorePaths ?? []),
    ];
    this.maskCookies = new Set(options.maskCookies ?? []);
    this.maskHeaders = new Set(
      (options.maskHeaders ?? DEFAULT_MASK_HEADERS).map((h) => h.toLowerCase()),
    );
    this.emitDebugHeaders = options.emitDebugHeaders ?? true;
    this.ignoreRequest = options.ignoreRequest;
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
    const rawRequestId = req.headers['x-request-id'];
    const requestId = Array.isArray(rawRequestId) ? rawRequestId[0] : rawRequestId;

    const profile: Profile<HttpRequestData> = {
      token,
      createdAt: Date.now(),
      entrypoint: {
        type: HTTP_ENTRYPOINT_TYPE,
        data: {
          method: req.method,
          url: req.originalUrl ?? req.url,
          headers: normalizeIncomingHeaders(req.headers, this.maskHeaders),
          query: req.query ?? {},
          ip: req.ip,
          requestId,
          body: this.collectBody ? this.normalizeBody(req.body) : undefined,
          cookies: this.buildCookieMap(req),
          session: this.buildSessionData(req),
        },
      },
      performance: {
        startTime: Date.now(),
        heapUsed: process.memoryUsage().heapUsed,
      },
      logs: [],
      exceptions: [],
      collectors: {},
    };

    (req as unknown as Record<symbol, unknown>)[PROFILER_REQ_KEY] = profile;

    this.cls.run(() => {
      this.cls.set('profiler.token', token);
      this.cls.set(PROFILER_CLS_KEYS.profile, profile);
      this.cls.set(PROFILER_CLS_KEYS.request, req);
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

    const getResponseBody = this.interceptResponseBody(rawRes, profile);

    rawRes.once('finish', () => {
      const interceptedResponseBody = getResponseBody();
      if (profile.response) {
        // The interceptor already finalized the profile. For GraphQL over HTTP it ran in
        // the non-HTTP (resolver) context and only saw the resolver result — never the
        // transport-level { data, errors } envelope the driver writes afterwards. Backfill
        // it so the Response tab shows what the client actually received, errors included.
        if (profile.entrypoint.data.graphql && interceptedResponseBody !== undefined) {
          profile.response.body = this.normalizeBody(interceptedResponseBody);
          profile.response.statusCode = rawRes.statusCode ?? profile.response.statusCode;
          this.core.scheduleSave(profile);
        }
        return; // otherwise the interceptor already finalized and saved
      }

      profile.performance.duration = Date.now() - profile.performance.startTime;
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
    if (reqPath.startsWith(this.profilerPath)) return true;
    if (this.sampleRate < 1.0 && Math.random() > this.sampleRate) return true;
    if (
      this.ignoreRequest?.({
        method: req.method,
        url: req.url,
        path: req.path,
        // The user's own skip predicate sees raw headers (never persisted) so it can inspect
        // e.g. `authorization` to decide what to profile.
        headers: normalizeIncomingHeaders(req.headers, EMPTY_MASK),
        body: req.body,
      })
    )
      return true;
    if (this.ignorePaths.length === 0) return false;
    return this.ignorePaths.some((p) =>
      typeof p === 'string' ? reqPath.startsWith(p) : p.test(reqPath),
    );
  }

  /** JSON-safe, size-bounded copy of a captured body (see `maxBodySize`). */
  private normalizeBody(body: unknown): unknown {
    return this.maxBodySize === undefined
      ? normalizeBody(body)
      : normalizeBody(body, this.maxBodySize);
  }

  private buildCookieMap(req: PlatformRequest): Record<string, string> | undefined {
    const raw = req.cookies ?? this.parseCookies(req.headers.cookie);
    if (Object.keys(raw).length === 0) return undefined;
    return Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, this.maskCookies.has(k) ? '[REDACTED]' : v]),
    );
  }

  private buildSessionData(req: PlatformRequest): Record<string, unknown> | undefined {
    if (!req.session) return undefined;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.session)) {
      if (typeof v !== 'function') data[k] = v;
    }
    // Session data commonly holds tokens/passport payloads — redact sensitive keys/values.
    return Object.keys(data).length > 0 ? redact(data) : undefined;
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
