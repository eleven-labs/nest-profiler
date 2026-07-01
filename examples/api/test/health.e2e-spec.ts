import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2EApp, getProfile, profileOf, server, tokenOf } from './helpers/app.js';

describe('Health endpoint (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('responds and links the profile via debug headers', async () => {
      const res = await request(server(app)).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });

      const token = tokenOf(res);
      expect(res.headers['x-debug-token-link']).toBe(`/_profiler/${token}`);
    });

    it('records request, route, performance and logs in the profile', async () => {
      const { profile } = await profileOf(app, 'get', '/health');

      expect(profile.entrypoint.data).toMatchObject({ method: 'GET', url: '/health' });
      expect(profile.response).toMatchObject({ statusCode: 200 });
      expect(profile.route).toMatchObject({
        controller: 'HealthController',
        handler: 'getHealth',
        method: 'GET',
      });
      expect(profile.performance.duration).toBeGreaterThanOrEqual(0);
      expect(profile.logs.length).toBeGreaterThan(0);
      expect(profile.logs.map((l) => l.message)).toEqual(
        expect.arrayContaining([expect.stringContaining('Health check')]),
      );
      expect(profile.exceptions).toHaveLength(0);
    });
  });

  describe('ignored requests', () => {
    it('does not profile /favicon.ico (ignorePaths)', async () => {
      const res = await request(server(app)).get('/favicon.ico');
      expect(res.headers['x-debug-token']).toBeUndefined();
    });
  });

  describe('profiler data endpoint', () => {
    it('returns 404 for an unknown token', async () => {
      const res = await request(server(app)).get('/_profiler/00000000-unknown-token/data');
      expect(res.status).toBe(404);
    });

    it('returns the exact profile for a known token', async () => {
      const token = tokenOf(await request(server(app)).get('/health'));
      const profile = await getProfile(app, token);
      expect(profile.token).toBe(token);
    });
  });
});
