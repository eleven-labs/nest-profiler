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
    it('captures the manual spans and nests them under the one that opened them', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/slow');

      expect(res.status).toBe(200);
      const labels = (profile.trace ?? []).map((s) => s.label);
      expect(labels).toEqual(
        expect.arrayContaining([
          'slow.total',
          'slow.step.fetch',
          'slow.step.process',
          'slow.step.serialize',
        ]),
      );

      const total = profile.trace?.find((s) => s.label === 'slow.total');
      // 30 + 20 + 10ms of simulated work; allow a small tolerance since setTimeout
      // can fire a hair early, occasionally yielding 59ms for the aggregate span.
      expect(total?.duration).toBeGreaterThanOrEqual(55);
      expect(total?.meta).toMatchObject({ steps: 3 });

      // The point of the span stack: the three steps report `slow.total` as their parent because
      // they opened while it was active — no timing heuristic involved.
      const steps = (profile.trace ?? []).filter((s) => s.label.startsWith('slow.step.'));
      expect(steps).toHaveLength(3);
      expect(steps.map((s) => s.parentId)).toEqual([total!.id, total!.id, total!.id]);
    });

    it('records the CPU, memory and event-loop cost of the request', async () => {
      const { profile } = await profileOf(app, 'get', '/api/v1/slow');
      const perf = profile.performance;

      // CPU: /slow mostly waits on timers, so its CPU is a small fraction of its duration —
      // which is precisely the distinction these figures exist to make.
      expect(perf.cpu).toBeDefined();
      expect(perf.cpu!.total).toBeGreaterThanOrEqual(0);
      expect(perf.cpu!.total).toBeCloseTo(perf.cpu!.user + perf.cpu!.system, 3);
      expect(perf.cpu!.total).toBeLessThan(perf.duration!);

      // Memory: absolute values are positive, deltas may legitimately be negative after a GC.
      expect(perf.memory!.heapUsedAfter).toBeGreaterThan(0);
      expect(perf.memory!.rss).toBeGreaterThan(0);
      expect(Number.isFinite(perf.memory!.heapDelta)).toBe(true);

      // Event loop: a ratio, and the two halves of the window it splits.
      expect(perf.eventLoop!.utilization).toBeGreaterThanOrEqual(0);
      expect(perf.eventLoop!.utilization).toBeLessThanOrEqual(1);
      expect(perf.eventLoop!.active + perf.eventLoop!.idle).toBeGreaterThan(0);

      // GC is only reported while runtime metrics are enabled, which the demo enables.
      expect(perf.gc).toBeDefined();
      expect(perf.gc!.count).toBeGreaterThanOrEqual(0);
    });

    it('measures spans and the request on a monotonic clock, with sub-millisecond resolution', async () => {
      const { profile } = await profileOf(app, 'get', '/api/v1/slow');

      // Every span, and the request itself, is a non-negative fractional millisecond count.
      for (const span of profile.trace ?? []) {
        expect(span.duration).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(span.duration)).toBe(true);
      }
      expect(profile.performance.duration).toBeGreaterThanOrEqual(0);

      // At least one measurement carries a fraction — proof the clock is not millisecond-floored.
      // The serialize step is the sub-millisecond one; the request duration always has decimals.
      const measured = [
        profile.performance.duration ?? 0,
        ...(profile.trace ?? []).map((s) => s.duration),
      ];
      expect(measured.some((value) => !Number.isInteger(value))).toBe(true);
      // Rounded to microseconds rather than shipped as raw float noise.
      for (const value of measured) {
        expect(String(value).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
      }
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
      // The cause chain is what says why: the outer exception carries no diagnosis.
      expect(profile.exceptions[0]?.cause).toMatchObject({
        message: expect.stringContaining('ECONNREFUSED') as string,
        code: 'ECONNREFUSED',
      });
      expect((profile.tags ?? []).map((t) => t.id)).toContain('error');
    });

    it('records the whole stack as frames, application code first and annotated', async () => {
      const { profile } = await profileOf(app, 'get', '/api/v1/crash');
      const frames = profile.exceptions[0]?.frames ?? [];

      // The throw site: application code, named after its class rather than the instrumentation
      // Proxy it runs behind, and carrying the source around the faulty line.
      const [thrownAt] = frames;
      expect(thrownAt).toMatchObject({
        isApplication: true,
        function: 'DiagnosticsController.crash',
      });
      expect(thrownAt?.file).not.toMatch(/^\/|^file:/);
      expect(thrownAt?.lines?.some((line) => line.isFaultLine)).toBe(true);

      // Everything below the application is kept too — that is what the UI groups and counts.
      expect(frames.filter((frame) => !frame.isApplication).length).toBeGreaterThan(0);
      expect(frames.length).toBeLessThanOrEqual(50);

      // The cause gets the same treatment, since it is what actually says what went wrong.
      expect(profile.exceptions[0]?.cause?.frames?.[0]).toMatchObject({ isApplication: true });
    });
  });
});
