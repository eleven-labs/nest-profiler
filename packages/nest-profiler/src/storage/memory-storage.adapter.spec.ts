import { MemoryStorageAdapter } from './memory-storage.adapter';
import type { Profile } from '../interfaces/profile.interface';

// The shared save/findOne/findAll/TTL/LRU/clear behaviour is covered once for every
// adapter in `storage-adapter.contract.spec.ts`. What remains here is what is specific
// to the in-memory adapter: every method returns synchronously (never a Promise), which
// is the property the service's synchronous fast paths rely on.

function makeProfile(token: string, overrides: Partial<Profile> = {}): Profile {
  return {
    token,
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: `/${token}`, headers: {}, query: {} } },
    performance: { startTime: 0, heapUsed: 0, duration: 1 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

describe('MemoryStorageAdapter', () => {
  it('returns synchronously from save, findOne, findAll and clear (never a Promise)', () => {
    const adapter = new MemoryStorageAdapter();

    expect(adapter.save(makeProfile('a'))).toBeUndefined();
    const found = adapter.findOne('a');
    expect(found).not.toBeInstanceOf(Promise);
    expect(found?.token).toBe('a');

    const all = adapter.findAll();
    expect(all).not.toBeInstanceOf(Promise);
    expect(all.map((p) => p.token)).toEqual(['a']);

    expect(adapter.clear()).toBeUndefined();
    expect(adapter.findAll()).toEqual([]);
  });
});
