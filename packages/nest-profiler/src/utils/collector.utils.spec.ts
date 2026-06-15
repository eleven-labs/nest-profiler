import { appendCollectorEntry, getCollectorEntries } from './collector.utils';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(collectors: Record<string, unknown> = {}): Profile {
  return {
    token: 't',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors,
  };
}

describe('getCollectorEntries', () => {
  it('returns an empty array when the key is absent', () => {
    expect(getCollectorEntries(makeProfile(), 'queries')).toEqual([]);
  });

  it('returns an empty array when the stored value is not an array', () => {
    expect(getCollectorEntries(makeProfile({ queries: { not: 'array' } }), 'queries')).toEqual([]);
  });

  it('returns the existing typed array', () => {
    const entries = [{ id: 1 }, { id: 2 }];
    expect(getCollectorEntries(makeProfile({ queries: entries }), 'queries')).toBe(entries);
  });
});

describe('appendCollectorEntry', () => {
  it('initialises the array on first call and appends', () => {
    const profile = makeProfile();
    appendCollectorEntry(profile, 'queries', { id: 1 });
    expect(profile.collectors['queries']).toEqual([{ id: 1 }]);
  });

  it('appends to an existing array', () => {
    const profile = makeProfile({ queries: [{ id: 1 }] });
    appendCollectorEntry(profile, 'queries', { id: 2 });
    expect(profile.collectors['queries']).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('replaces a non-array value with a fresh array', () => {
    const profile = makeProfile({ queries: 'corrupt' });
    appendCollectorEntry(profile, 'queries', { id: 1 });
    expect(profile.collectors['queries']).toEqual([{ id: 1 }]);
  });
});
