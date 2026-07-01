import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SecurityContext } from '@eleven-labs/nest-profiler';
import { createE2EApp, getProfile, server, tokenOf } from './helpers/app.js';

describe('Auth endpoints (e2e) — auth collector / security panel', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /auth/token issues a demo JWT', async () => {
    const res = await request(server(app)).get('/api/v1/auth/token').query({ role: 'admin' });

    expect(res.status).toBe(200);
    const body = res.body as { token: string };
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(3);
  });

  it('GET /auth/me with a Bearer token records an authenticated security context', async () => {
    const tokenRes = await request(server(app)).get('/api/v1/auth/token').query({ role: 'admin' });
    const jwt = (tokenRes.body as { token: string }).token;

    const res = await request(server(app))
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(200);

    const profile = await getProfile(app, tokenOf(res));
    expect(profile.security).toMatchObject({
      isAuthenticated: true,
      roles: ['admin'],
    });
    expect(profile.security?.user).toMatchObject({ username: 'demo_user' });
    expect(profile.security?.jwtClaims).toMatchObject({ sub: '42' });

    // The auth collector stores the same context under its collector key.
    const collected = profile.collectors['auth'] as SecurityContext;
    expect(collected).toMatchObject({ isAuthenticated: true });
  });

  it('GET /auth/me without a token is rejected with 401 and an anonymous security context', async () => {
    const res = await request(server(app)).get('/api/v1/auth/me');

    expect(res.status).toBe(401);

    const profile = await getProfile(app, tokenOf(res));
    expect(profile.response?.statusCode).toBe(401);
    expect(profile.security).toMatchObject({ isAuthenticated: false });
    expect(profile.security?.user).toBeUndefined();

    // The 401 is thrown by JwtAuthGuard, which runs before the interceptor — the
    // exception filter must still surface it in the Exceptions tab.
    expect(profile.exceptions).toHaveLength(1);
    expect(profile.exceptions[0]).toMatchObject({
      name: 'UnauthorizedException',
      message: 'Missing Bearer token — get one from GET /auth/token',
    });
  });

  it('GET /auth/me with a malformed token is rejected with 401', async () => {
    const res = await request(server(app))
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
  });
});
