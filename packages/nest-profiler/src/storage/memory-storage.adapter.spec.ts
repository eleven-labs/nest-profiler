import { MemoryStorageAdapter } from './memory-storage.adapter';
import type { Profile } from '../interfaces/profile.interface';

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
  describe('save / findOne', () => {
    it('stores and retrieves a profile by token', () => {
      const adapter = new MemoryStorageAdapter();
      const profile = makeProfile('a');
      adapter.save(profile);
      expect(adapter.findOne('a')).toBe(profile);
    });

    it('returns undefined for an unknown token', () => {
      const adapter = new MemoryStorageAdapter();
      expect(adapter.findOne('missing')).toBeUndefined();
    });

    it('evicts the oldest profile when maxProfiles is exceeded (LRU)', () => {
      const adapter = new MemoryStorageAdapter({ maxProfiles: 2 });
      adapter.save(makeProfile('a'));
      adapter.save(makeProfile('b'));
      adapter.save(makeProfile('c'));
      expect(adapter.findOne('a')).toBeUndefined();
      expect(adapter.findOne('b')).toBeDefined();
      expect(adapter.findOne('c')).toBeDefined();
    });
  });

  describe('TTL expiration', () => {
    it('findOne drops and returns undefined for an expired profile', () => {
      const adapter = new MemoryStorageAdapter({ ttl: 1 });
      adapter.save(makeProfile('old', { createdAt: Date.now() - 5000 }));
      expect(adapter.findOne('old')).toBeUndefined();
      // A subsequent valid save then findAll should not surface the expired one
      adapter.save(makeProfile('fresh'));
      expect(adapter.findAll().map((p) => p.token)).toEqual(['fresh']);
    });

    it('findAll filters out expired profiles', () => {
      const adapter = new MemoryStorageAdapter({ ttl: 1 });
      adapter.save(makeProfile('expired', { createdAt: Date.now() - 5000 }));
      adapter.save(makeProfile('valid'));
      expect(adapter.findAll().map((p) => p.token)).toEqual(['valid']);
    });
  });

  describe('findAll', () => {
    it('returns profiles in reverse insertion order (newest first)', () => {
      const adapter = new MemoryStorageAdapter();
      adapter.save(makeProfile('a'));
      adapter.save(makeProfile('b'));
      adapter.save(makeProfile('c'));
      expect(adapter.findAll().map((p) => p.token)).toEqual(['c', 'b', 'a']);
    });

    it('delegates filtering to applyProfileFilters', () => {
      const adapter = new MemoryStorageAdapter();
      adapter.save(
        makeProfile('a', {
          entrypoint: { type: 'http', data: { method: 'GET', url: '/a', headers: {}, query: {} } },
        }),
      );
      adapter.save(
        makeProfile('b', {
          entrypoint: { type: 'http', data: { method: 'POST', url: '/b', headers: {}, query: {} } },
        }),
      );
      const result = adapter.findAll({ method: 'POST' });
      expect(result.map((p) => p.token)).toEqual(['b']);
    });
  });

  describe('clear', () => {
    it('removes all stored profiles', () => {
      const adapter = new MemoryStorageAdapter();
      adapter.save(makeProfile('a'));
      adapter.clear();
      expect(adapter.findAll()).toEqual([]);
      expect(adapter.findOne('a')).toBeUndefined();
    });
  });
});
