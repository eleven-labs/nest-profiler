import { Test } from '@nestjs/testing';
import { ProfilerService } from './nest-profiler.service';
import type { ProfilerCoreService } from './profiler-core.service';
import { ClsModule, ClsService } from 'nestjs-cls';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(token: string): Profile {
  return {
    token,
    createdAt: Date.now(),
    request: { method: 'GET', url: '/', headers: {}, query: {} },
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

  it('addLog appends to active profile', () => {
    const profile = makeProfile('t1');
    cls.run(() => {
      cls.set('profiler.profile', profile);
      service.addLog({ level: 'log', message: 'hello', timestamp: Date.now() });
    });
    expect(profile.logs).toHaveLength(1);
    expect(profile.logs[0]?.message).toBe('hello');
  });

  it('addLog does nothing outside CLS context', () => {
    expect(() =>
      service.addLog({ level: 'log', message: 'noop', timestamp: Date.now() }),
    ).not.toThrow();
  });

  it('addException appends to active profile', () => {
    const profile = makeProfile('t2');
    cls.run(() => {
      cls.set('profiler.profile', profile);
      service.addException({ name: 'Error', message: 'boom', timestamp: Date.now() });
    });
    expect(profile.exceptions).toHaveLength(1);
    expect(profile.exceptions[0]?.message).toBe('boom');
  });

  it('addEvent appends an event to the active profile', () => {
    const profile = makeProfile('t-evt');
    cls.run(() => {
      cls.set('profiler.profile', profile);
      service.addEvent({ eventName: 'user.created', timestamp: Date.now() });
    });
    expect(profile.events).toHaveLength(1);
    expect(profile.events?.[0]?.eventName).toBe('user.created');
  });

  it('addEvent does nothing outside CLS context', () => {
    expect(() => service.addEvent({ eventName: 'noop', timestamp: Date.now() })).not.toThrow();
  });

  it('setSecurityContext stores the security context on the active profile', () => {
    const profile = makeProfile('t-sec');
    cls.run(() => {
      cls.set('profiler.profile', profile);
      service.setSecurityContext({ isAuthenticated: true, roles: ['admin'] });
    });
    expect(profile.security).toEqual({ isAuthenticated: true, roles: ['admin'] });
  });

  it('setSecurityContext does nothing outside CLS context', () => {
    expect(() => service.setSecurityContext({ isAuthenticated: false })).not.toThrow();
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

  it('createLogger wraps a delegate and captures logs', () => {
    const delegate = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const profile = makeProfile('t3');
    const logger = service.createLogger(delegate);
    cls.run(() => {
      cls.set('profiler.profile', profile);
      logger.log('test message', 'TestContext');
    });
    expect(delegate.log).toHaveBeenCalled();
    expect(profile.logs).toHaveLength(1);
    expect(profile.logs[0]?.level).toBe('log');
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
