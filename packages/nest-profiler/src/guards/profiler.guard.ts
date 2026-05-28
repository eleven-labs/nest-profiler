import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PlatformRequest } from '../types/http';

@Injectable()
export class ProfilerGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const token = process.env['PROFILER_TOKEN'];
    if (!token) return true;

    const req = ctx.switchToHttp().getRequest<PlatformRequest>();
    const auth = req.headers['authorization'];

    if (auth !== `Bearer ${token}`) {
      throw new UnauthorizedException('Access to the profiler requires a valid PROFILER_TOKEN.');
    }
    return true;
  }
}
