import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

/** Cookie carrying the demo JWT so the profiler's `cookie` auth strategy is browser-navigable. */
export const PROFILER_JWT_COOKIE = 'profiler_jwt';

/**
 * Decodes a JWT from the `profiler_jwt` cookie (browser-navigable — sent automatically on every
 * link) or, failing that, the `Authorization: Bearer` header (API/CLI), and populates request.user.
 * Does NOT verify the signature — display purposes only for profiler demo. Rejects with 401 when the
 * JWT is missing or malformed. Reused as-is by the profiler's `cookie` security strategy via
 * `security.guards`.
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
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const jwt = readCookie(request.headers['cookie'], PROFILER_JWT_COOKIE) ?? bearer;
    if (!jwt) {
      throw new UnauthorizedException(
        'Missing JWT — get one from GET /auth/token (cookie or Bearer)',
      );
    }

    const payload = parseJwtPayload(jwt);
    if (!payload) {
      throw new UnauthorizedException('Malformed JWT payload');
    }

    request.user = payload;
    return true;
  }
}

/** Reads a named cookie from the raw `Cookie` header (no cookie-parser dependency needed). */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

export function parseJwtPayload(token: string): object | undefined {
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
