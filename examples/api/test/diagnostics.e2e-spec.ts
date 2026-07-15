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

  describe('GET /crash', () => {
    it('captures the thrown exception and tags the profile as an error', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/crash');

      expect(res.status).toBe(500);
      expect(profile.response?.statusCode).toBe(500);
      expect(profile.exceptions[0]).toMatchObject({
        name: 'InternalServerErrorException',
        message: expect.stringContaining('simulated crash') as string,
      });
      expect((profile.tags ?? []).map((t) => t.id)).toContain('error');
    });
  });
});
