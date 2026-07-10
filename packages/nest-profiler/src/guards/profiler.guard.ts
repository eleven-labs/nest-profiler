import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { PlatformRequest, PlatformResponse } from '../types/http';

/** Narrows an already-instantiated guard from a guard class. */
function isGuardInstance(entry: Type<CanActivate> | CanActivate): entry is CanActivate {
  return typeof (entry as CanActivate).canActivate === 'function';
}

/**
 * Enforces the pluggable {@link ProfilerModuleOptions.security} strategy on every profiler
 * route. With no strategy configured the profiler is open (local-dev default). When an
 * `authorize` predicate and/or `guards` are provided, **all** must pass; the first that
 * denies throws `401`. Static assets (`__assets/*`) are always exempt so the UI's CSS/JS can
 * load even behind auth (a `<link>`/`<script>` cannot send credentials).
 */
@Injectable()
export class ProfilerGuard implements CanActivate {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    private readonly options: ProfilerModuleOptions = {},
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<PlatformRequest>();

    // Static assets (CSS/JS) carry no sensitive data and cannot send credentials when loaded
    // via <link>/<script>. Exempt them so the UI (and the injected toolbar on host pages) can
    // always load its stylesheet and scripts even when a security strategy is configured.
    const url = req.originalUrl ?? req.url ?? '';
    if (url.includes('/__assets/')) return true;

    const security = this.options.security;
    if (!security) return true;

    const res = http.getResponse<PlatformResponse>();

    if (security.authorize) {
      const allowed = await security.authorize({ request: req, response: res });
      if (!allowed) throw new UnauthorizedException('Access to the profiler is not authorized.');
    }

    for (const entry of security.guards ?? []) {
      const guard = await this.resolveGuard(entry);
      const allowed = await guard.canActivate(ctx);
      if (!allowed) throw new UnauthorizedException('Access to the profiler is not authorized.');
    }

    return true;
  }

  /**
   * Resolves a configured guard: a ready instance is used as-is; a class is fetched from the
   * DI container when it is a registered singleton, otherwise instantiated with its
   * dependencies resolved from the module context.
   */
  private async resolveGuard(entry: Type<CanActivate> | CanActivate): Promise<CanActivate> {
    if (isGuardInstance(entry)) return entry;
    try {
      return this.moduleRef.get(entry, { strict: false });
    } catch {
      return this.moduleRef.create(entry);
    }
  }
}
