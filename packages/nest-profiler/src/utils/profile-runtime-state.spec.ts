import {
  deferCollectionToFinishHook,
  isCollectionDeferred,
  readTransportResponseBody,
  setTransportResponseBody,
} from './profile-runtime-state';
import type { Profile } from '../interfaces/profile.interface';

const AT = 1_700_000_000_000;

function makeProfile(token = 't'): Profile {
  return {
    token,
    traceId: `trace-${token}`,
    createdAt: AT,
    entrypoint: { type: 'http', data: {} },
    performance: { startTime: AT, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('profile runtime state', () => {
  it('reports no deferral and no transport body for an untouched profile', () => {
    const profile = makeProfile();
    expect(isCollectionDeferred(profile)).toBe(false);
    expect(readTransportResponseBody(profile)).toBeUndefined();
  });

  it('marks collection as deferred to the finish hook', () => {
    const profile = makeProfile();
    deferCollectionToFinishHook(profile);
    expect(isCollectionDeferred(profile)).toBe(true);
  });

  it('reads the transport body back through the registered getter, at call time', () => {
    const profile = makeProfile();
    let written: unknown = 'not sent yet';
    setTransportResponseBody(profile, () => written);

    expect(readTransportResponseBody(profile)).toBe('not sent yet');
    written = { data: { ok: true } };
    expect(readTransportResponseBody(profile)).toEqual({ data: { ok: true } });
  });

  it('keeps the state of each profile to itself', () => {
    const first = makeProfile('a');
    const second = makeProfile('b');

    deferCollectionToFinishHook(first);
    setTransportResponseBody(first, () => 'first body');

    expect(isCollectionDeferred(second)).toBe(false);
    expect(readTransportResponseBody(second)).toBeUndefined();
  });

  // The whole point of the WeakMap: this state is transport plumbing, never part of the document
  // that gets stored and exported by `/:token/data`.
  it('puts nothing on the profile object itself', () => {
    const profile = makeProfile();
    deferCollectionToFinishHook(profile);
    setTransportResponseBody(profile, () => 'body');

    expect(Object.getOwnPropertySymbols(profile)).toEqual([]);
    expect(JSON.parse(JSON.stringify(profile))).toEqual(JSON.parse(JSON.stringify(makeProfile())));
  });
});
