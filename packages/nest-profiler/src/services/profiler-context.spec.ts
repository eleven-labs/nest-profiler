import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { readProfile, readRequest, readToken, setProfileContext } from './profiler-context';
import { PROFILER_CLS_KEYS } from '../constants';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(token = 't-1'): Profile {
  return {
    token,
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('profiler context accessors', () => {
  let cls: ClsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
    }).compile();
    cls = module.get(ClsService);
  });

  it('reads back what setProfileContext published', () => {
    const profile = makeProfile('t-published');
    const request = { url: '/users' };

    cls.run(() => {
      setProfileContext(cls, profile, request);

      expect(readProfile(cls)).toBe(profile);
      expect(readToken(cls)).toBe('t-published');
      expect(readRequest(cls)).toBe(request);
    });
  });

  it('derives the token from the profile, so the two can never disagree', () => {
    const profile = makeProfile('t-derived');
    cls.run(() => {
      setProfileContext(cls, profile);
      expect(readToken(cls)).toBe(profile.token);
    });
  });

  it('leaves the request unset when none is supplied', () => {
    cls.run(() => {
      setProfileContext(cls, makeProfile());
      expect(readRequest(cls)).toBeUndefined();
    });
  });

  it('returns undefined outside an active CLS context instead of throwing', () => {
    // The normal case at bootstrap, in a background job, or with the profiler disabled.
    expect(() => readProfile(cls)).not.toThrow();
    expect(readProfile(cls)).toBeUndefined();
    expect(readToken(cls)).toBeUndefined();
    expect(readRequest(cls)).toBeUndefined();
  });

  it('returns undefined when there is no ClsService at all', () => {
    // What a collector gets from `tryResolve` when the profiler core is disabled.
    expect(readProfile(undefined)).toBeUndefined();
    expect(readToken(undefined)).toBeUndefined();
    expect(readRequest(undefined)).toBeUndefined();
  });

  it('returns undefined inside a context that carries no profile', () => {
    cls.run(() => {
      expect(readProfile(cls)).toBeUndefined();
      expect(readToken(cls)).toBeUndefined();
    });
  });

  it('reads the very keys collector packages write, so a rename cannot split them', () => {
    const profile = makeProfile('t-keys');
    cls.run(() => {
      // Written by key rather than through the helper: this is what an external package that
      // still sets the store by hand would do, and it must remain readable.
      cls.set(PROFILER_CLS_KEYS.profile, profile);
      cls.set(PROFILER_CLS_KEYS.token, profile.token);

      expect(readProfile(cls)).toBe(profile);
      expect(readToken(cls)).toBe('t-keys');
    });
  });

  it('exposes the token key the store is actually keyed by', () => {
    // It was missing from PROFILER_CLS_KEYS while three packages wrote the literal.
    expect(PROFILER_CLS_KEYS.token).toBe('profiler.token');
  });
});
