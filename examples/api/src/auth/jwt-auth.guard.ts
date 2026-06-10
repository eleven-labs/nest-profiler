import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

/**
 * Decodes a JWT from the Authorization header and populates request.user.
 * Does NOT verify the signature — display purposes only for profiler demo.
 * Rejects with 401 when the Bearer token is missing or malformed.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<
        IncomingMessage & { user?: unknown; headers: Record<string, string | undefined> }
      >();

    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token — get one from GET /auth/token');
    }

    const payload = parseJwtPayload(authHeader.slice(7));
    if (!payload) {
      throw new UnauthorizedException('Malformed JWT payload');
    }

    request.user = payload;
    return true;
  }
}

function parseJwtPayload(token: string): object | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf-8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
