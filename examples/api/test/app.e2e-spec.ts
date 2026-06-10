import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2EApp, getProfile, profileOf, server, tokenOf } from './helpers/app.js';

describe('App endpoints (e2e)', () => {
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

      expect(profile.request).toMatchObject({ method: 'GET', url: '/health' });
      expect(profile.response).toMatchObject({ statusCode: 200 });
      expect(profile.route).toMatchObject({
        controller: 'AppController',
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

  describe('GET /slow', () => {
    it('captures the manual timeline spans', async () => {
      const { res, profile } = await profileOf(app, 'get', '/slow');

      expect(res.status).toBe(200);
      const phases = (profile.spans ?? []).map((s) => s.phase);
      expect(phases).toEqual(
        expect.arrayContaining([
          'slow.total',
          'slow.step.fetch',
          'slow.step.process',
          'slow.step.serialize',
        ]),
      );
      const total = profile.spans?.find((s) => s.phase === 'slow.total');
      expect(total?.duration).toBeGreaterThanOrEqual(60); // 30 + 20 + 10ms of simulated work
    });
  });

  describe('GET /error', () => {
    it('captures the thrown exception in the profile', async () => {
      const { res, profile } = await profileOf(app, 'get', '/error');

      expect(res.status).toBe(400);
      expect(profile.response?.statusCode).toBe(400);
      expect(profile.exceptions.length).toBeGreaterThanOrEqual(1);
      expect(profile.exceptions[0]).toMatchObject({
        name: 'BadRequestException',
        message: expect.stringContaining('simulated error') as string,
      });
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
