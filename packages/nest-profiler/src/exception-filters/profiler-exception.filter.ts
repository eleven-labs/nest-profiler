import { ArgumentsHost, Catch, Inject, Injectable, Optional } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { PROFILER_REQ_KEY } from '../constants';
import { readProfile } from '../services/profiler-context';
import { toExceptionEntry } from '../analysis/to-exception-entry';
import { resolveSourceContextOptions } from '../utils/source-context.util';
import type { SourceContextOptions } from '../utils/source-context.util';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';

/**
 * Records exceptions that never reach {@link ProfilerInterceptor}.
 *
 * In the NestJS request lifecycle **guards run before interceptors**, so when a
 * guard rejects a request (e.g. an auth guard throwing `UnauthorizedException`)
 * the interceptor's `catchError` never fires. The profile is still saved by the
 * middleware's `finish` safety net — with the right status and security context —
 * but its `exceptions` array stays empty and the Exceptions tab shows nothing.
 *
 * This catch-all filter observes the exception on its way out and pushes it onto
 * the active profile. For HTTP it extends {@link BaseExceptionFilter} and delegates
 * to `super.catch()`, so the framework's default response formatting is preserved
 * byte-for-byte.
 *
 * For non-HTTP contexts (GraphQL/RPC) it must **not** call `super.catch()`: the base
 * filter's reply path is HTTP-only and calls `response.status()` on the transport's
 * argument, which for GraphQL is the resolver `args` object — throwing
 * `response.status is not a function` and masking the real resolver error. Instead it
 * re-throws the original exception so the framework's own handling (e.g. GraphQL's
 * `{ errors }` formatting) takes over; the interceptor has already recorded it.
 */
@Injectable()
@Catch()
export class ProfilerExceptionFilter extends BaseExceptionFilter {
  private readonly sourceContext: SourceContextOptions | undefined;

  constructor(
    @Optional() private readonly cls?: ClsService,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
  ) {
    super();
    this.sourceContext = resolveSourceContextOptions(options.sourceContext);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType<string>() !== 'http') {
      // Let GraphQL/RPC format their own error response — see class docblock.
      throw exception;
    }
    this.recordHttpException(exception, host);
    super.catch(exception, host);
  }

  private recordHttpException(exception: unknown, host: ArgumentsHost): void {
    const profile = this.resolveProfile(host);
    // When the interceptor handled the request it already finalized the profile
    // (and pushed any handler/pipe exception), so `response` is set by now. Only
    // capture exceptions that bypassed the interceptor entirely — i.e. those
    // thrown by guards or anything running before it.
    if (!profile || profile.response) return;

    profile.exceptions.push(toExceptionEntry(exception, { sourceContext: this.sourceContext }));
  }

  private resolveProfile(host: ArgumentsHost): Profile | undefined {
    // Outside an active CLS context, fall back to the request-bound profile.
    const fromCls = readProfile(this.cls);
    if (fromCls) return fromCls;
    const req = host.switchToHttp().getRequest<Record<symbol, unknown> | undefined>();
    return req?.[PROFILER_REQ_KEY] as Profile | undefined;
  }
}
