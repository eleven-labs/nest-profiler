import type { INestApplication } from '@nestjs/common';
import { createE2EApp, profileOf } from './helpers/app.js';

describe('Diagnostics endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /slow', () => {
    it('captures the manual timeline spans', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/slow');

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
      // 30 + 20 + 10ms of simulated work; allow a small tolerance since setTimeout
      // can fire a hair early, occasionally yielding 59ms for the aggregate span.
      expect(total?.duration).toBeGreaterThanOrEqual(55);
    });
  });

  describe('GET /error', () => {
    it('captures the thrown exception in the profile', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/error');

      expect(res.status).toBe(400);
      expect(profile.response?.statusCode).toBe(400);
      expect(profile.exceptions.length).toBeGreaterThanOrEqual(1);
      expect(profile.exceptions[0]).toMatchObject({
        name: 'BadRequestException',
        message: expect.stringContaining('simulated error') as string,
      });
    });
  });
});
