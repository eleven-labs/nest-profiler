import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { PlatformRequest } from '../types/http';

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
    const auth = req.headers['authorization'];

    if (auth !== `Bearer ${token}`) {
      throw new UnauthorizedException('Access to the profiler requires a valid PROFILER_TOKEN.');
    }
    return true;
  }
}
