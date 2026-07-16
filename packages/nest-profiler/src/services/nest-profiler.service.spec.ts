import { Test } from '@nestjs/testing';
import { ProfilerService } from './nest-profiler.service';
import type { ProfilerCoreService } from './profiler-core.service';
import { ClsModule, ClsService } from 'nestjs-cls';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(token: string): Profile {
  return {
    token,
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('ProfilerService', () => {
  let service: ProfilerService;
  let cls: ClsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
      providers: [ProfilerService],
    }).compile();
    service = module.get(ProfilerService);
    cls = module.get(ClsService);
  });

  it('getCurrentToken returns undefined outside CLS context', () => {
    expect(service.getCurrentToken()).toBeUndefined();
  });

  it('getCurrentToken returns token inside CLS context', () => {
    cls.run(() => {
      cls.set('profiler.token', 'test-token');
      expect(service.getCurrentToken()).toBe('test-token');
    });
  });

  it('startSpan records a timeline span when stopped inside CLS context', () => {
    const profile = makeProfile('t-span');
    cls.run(() => {
      cls.set('profiler.profile', profile);
      const stop = service.startSpan('db.query');
      stop();
    });
    expect(profile.spans).toHaveLength(1);
    expect(profile.spans?.[0]?.phase).toBe('db.query');
    expect(profile.spans?.[0]?.duration).toBeGreaterThanOrEqual(0);
  });

  it('startSpan stop is a no-op outside CLS context', () => {
    const stop = service.startSpan('orphan');
    expect(() => stop()).not.toThrow();
  });

  it('flush is a safe no-op when the profiler is disabled (no core)', async () => {
    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('flush drains the pending profile persistence of the core service', async () => {
    const flushPendingProfiles = jest.fn().mockResolvedValue(undefined);
    const withCore = new ProfilerService(cls, {
      flushPendingProfiles,
    } as unknown as ProfilerCoreService);

    await withCore.flush();

    expect(flushPendingProfiles).toHaveBeenCalled();
  });
});
