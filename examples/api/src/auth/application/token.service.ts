import { Injectable } from '@nestjs/common';

export interface DemoToken {
  token: string;
  usage: string;
}

/**
 * Issues a demo JWT (unsigned) for the profiler Security panel. Signature is NOT produced/verified —
 * display purposes only. Kept in the application layer so the controller stays thin.
 */
@Injectable()
export class TokenService {
  issue(role: string): DemoToken {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '42',
        username: 'demo_user',
        email: 'demo@example.com',
        roles: [role],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const token = `${header}.${payload}.demo_sig_not_verified`;
    return {
      token,
      usage: `curl -H "Authorization: Bearer ${token}" http://localhost:3000/auth/me`,
    };
  }
}
