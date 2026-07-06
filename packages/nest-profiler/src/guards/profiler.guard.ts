import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { PlatformRequest } from '../types/http';

/** Constant-time string comparison that first guards against length leaks. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

@Injectable()
export class ProfilerGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    private readonly options: ProfilerModuleOptions = {},
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const token = this.options.token ?? process.env['PROFILER_TOKEN'];
    if (!token) return true;

    const req = ctx.switchToHttp().getRequest<PlatformRequest>();

    // Static assets (CSS/JS) carry no sensitive data and cannot send an Authorization header
    // when loaded via <link>/<script>. Exempt them so the UI (and the injected toolbar on host
    // pages) can always load its stylesheet and scripts even when a token is configured.
    const url = req.originalUrl ?? req.url ?? '';
    if (url.includes('/__assets/')) return true;

    // Accept the token from the Authorization header (API clients) or the `?token=` query
    // parameter (browser navigation — a browser cannot set headers when following a link).
    const auth = req.headers['authorization'];
    const bearer =
      typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const queryToken = req.query?.['token'];
    const fromQuery = Array.isArray(queryToken) ? queryToken[0] : queryToken;
    const provided = bearer ?? (typeof fromQuery === 'string' ? fromQuery : undefined);

    if (provided === undefined || !tokensMatch(provided, token)) {
      throw new UnauthorizedException('Access to the profiler requires a valid PROFILER_TOKEN.');
    }
    return true;
  }
}
