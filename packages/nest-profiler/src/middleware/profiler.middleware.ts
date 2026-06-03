import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { NextFunction, PlatformRequest, PlatformResponse } from '../types/http';
import type { Profile } from '../interfaces/profile.interface';
import { PROFILER_REQ_KEY } from '../constants';

function normalizeIncomingHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

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
      next();
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
