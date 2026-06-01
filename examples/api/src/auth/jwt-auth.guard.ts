import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

/**
 * Decodes a JWT from the Authorization header and populates request.user.
 * Does NOT verify the signature — display purposes only for profiler demo.
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
    if (!authHeader?.startsWith('Bearer ')) return true;

    const payload = parseJwtPayload(authHeader.slice(7));
    if (payload) request.user = payload;
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
