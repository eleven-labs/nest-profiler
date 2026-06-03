import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { NextFunction, PlatformRequest, PlatformResponse } from '../types/http';
import type { Profile } from '../interfaces/profile.interface';
import { PROFILER_REQ_KEY } from '../constants';
import { ProfilerCoreService } from '../services/profiler-core.service';

function normalizeIncomingHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

/** Shape of the raw Node.js / Express response used for lifecycle hooks. */
type RawResponse = {
  once?: (event: 'finish', fn: () => void) => void;
  statusCode?: number;
  json?: (body: unknown) => unknown;
  send?: (body: unknown) => unknown;
};

@Injectable()
export class ProfilerMiddleware implements NestMiddleware {
  private readonly profilerPath: string;
  private readonly collectBody: boolean;
  private readonly sampleRate: number;
  private readonly ignorePaths: (string | RegExp)[];
  private readonly maskCookies: Set<string>;

  constructor(
    private readonly cls: ClsService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
    // @Optional() — only available in the active (enabled) layer; null in the inert layer.
    @Optional() private readonly core: ProfilerCoreService,
  ) {
    this.profilerPath = options.path ?? '/_profiler';
    this.collectBody = options.collectBody ?? false;
    this.sampleRate = options.sampleRate ?? 1.0;
    this.ignorePaths = options.ignorePaths ?? [];
    this.maskCookies = new Set(options.maskCookies ?? []);
  }

  use(req: PlatformRequest, res: PlatformResponse, next: NextFunction): void {
    if (this.shouldSkip(req)) {
      next();
      return;
    }

    const requestId = req.headers['x-request-id'];
    const token = (Array.isArray(requestId) ? requestId[0] : requestId) ?? crypto.randomUUID();

    const profile: Profile = {
      token,
      createdAt: Date.now(),
      request: {
        method: req.method,
        url: req.originalUrl ?? req.url,
        headers: normalizeIncomingHeaders(req.headers),
        query: req.query ?? {},
        ip: req.ip,
        body: this.collectBody ? req.body : undefined,
        cookies: this.buildCookieMap(req),
        session: this.buildSessionData(req),
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
      this.cls.set('profiler.profile', profile);
      this.cls.set('profiler.request', req);
      res.setHeader('X-Debug-Token', token);
      res.setHeader('X-Debug-Token-Link', `${this.profilerPath}/${token}`);

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
  private attachFinishHook(profile: Profile, req: PlatformRequest, res: PlatformResponse): void {
    if (!this.core) return; // only active in the enabled layer
    const rawRes = res as unknown as RawResponse;
    if (!rawRes.once) return;

    // Intercept res.json() and res.send() to capture the response body.
    // Some GraphQL frameworks (e.g. Apollo Server 4) may call either method
    // directly instead of returning through NestJS's response pipeline.
    let interceptedResponseBody: unknown;

    const captureBody = (body: unknown): void => {
      if (interceptedResponseBody !== undefined) return;
      try {
        interceptedResponseBody = typeof body === 'string' ? (JSON.parse(body) as unknown) : body;
      } catch {
        interceptedResponseBody = body;
      }
    };

    const originalJson = rawRes.json?.bind(rawRes);
    if (originalJson) {
      rawRes.json = (body: unknown): unknown => {
        captureBody(body);
        return originalJson(body);
      };
    }

    const originalSend = rawRes.send?.bind(rawRes);
    if (originalSend) {
      rawRes.send = (body: unknown): unknown => {
        captureBody(body);
        return originalSend(body);
      };
    }

    rawRes.once('finish', () => {
      if (profile.response) return; // normal interceptor path already finalized and saved

      profile.performance.duration = Date.now() - profile.performance.startTime;
      profile.response = {
        statusCode: rawRes.statusCode ?? 200,
        headers: {},
        body: this.collectBody ? interceptedResponseBody : undefined,
      };

      this.core.enrichHttpResponse(
        profile,
        req as unknown as Record<string, unknown>,
        interceptedResponseBody,
      );

      void this.core.collectorRegistry
        .collectAll(profile)
        .then(() => this.core.storage.save(profile));
    });
  }

  private shouldSkip(req: PlatformRequest): boolean {
    const reqPath = req.path ?? req.url;
    if (reqPath.startsWith(this.profilerPath)) return true;
    if (this.sampleRate < 1.0 && Math.random() > this.sampleRate) return true;
    if (this.ignorePaths.length === 0) return false;
    return this.ignorePaths.some((p) =>
      typeof p === 'string' ? reqPath.startsWith(p) : p.test(reqPath),
    );
  }

  private buildCookieMap(req: PlatformRequest): Record<string, string> | undefined {
    const raw = req.cookies ?? this.parseCookies(req.headers.cookie);
    if (Object.keys(raw).length === 0) return undefined;
    return Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, this.maskCookies.has(k) ? '***' : v]),
    );
  }

  private buildSessionData(req: PlatformRequest): Record<string, unknown> | undefined {
    if (!req.session) return undefined;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.session)) {
      if (typeof v !== 'function') data[k] = v;
    }
    return Object.keys(data).length > 0 ? data : undefined;
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
