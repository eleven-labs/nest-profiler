import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileStorageAdapter } from './file-storage.adapter';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(token: string, createdAt = Date.now()): Profile {
  return {
    token,
    createdAt,
    request: { method: 'GET', url: `/${token}`, headers: {}, query: {} },
    performance: { startTime: createdAt, heapUsed: 0, duration: 10 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

async function tmpDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'profiler-test-'));
}

describe('FileStorageAdapter', () => {
  let dir: string;
  let adapter: FileStorageAdapter;

  beforeEach(async () => {
    dir = await tmpDir();
    adapter = new FileStorageAdapter({ storagePath: dir, maxProfiles: 3, ttl: 3600 });
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('saves a profile as a JSON file', async () => {
    const p = makeProfile('abc');
    await adapter.save(p);

    const files = await fs.promises.readdir(dir);
    expect(files).toContain('abc.json');

    const raw = JSON.parse(await fs.promises.readFile(path.join(dir, 'abc.json'), 'utf-8')) as {
      token: string;
    };
    expect(raw.token).toBe('abc');
  });

  it('findOne returns the saved profile', async () => {
    const p = makeProfile('token1');
    await adapter.save(p);
    const found = await adapter.findOne('token1');
    expect(found?.token).toBe('token1');
  });

  it('findOne returns undefined for unknown token', async () => {
    expect(await adapter.findOne('unknown')).toBeUndefined();
  });

  it('findAll returns profiles newest-first', async () => {
    const base = Date.now();
    await adapter.save(makeProfile('a', base));
    await adapter.save(makeProfile('b', base + 100));
    await adapter.save(makeProfile('c', base + 200));
    const all = await adapter.findAll();
    expect(all.map((p) => p.token)).toEqual(['c', 'b', 'a']);
  });

  it('evicts oldest profile when maxProfiles exceeded', async () => {
    await adapter.save(makeProfile('old'));
    await adapter.save(makeProfile('mid'));
    await adapter.save(makeProfile('new'));
    await adapter.save(makeProfile('extra')); // triggers eviction

    expect(await adapter.findOne('old')).toBeUndefined();
    expect(await adapter.findOne('extra')).toBeDefined();

    const files = await fs.promises.readdir(dir);
    expect(files).not.toContain('old.json');
  });

  it('filters expired profiles by TTL', async () => {
    const expiredAdapter = new FileStorageAdapter({ storagePath: dir, ttl: 1 });
    const expired = makeProfile('expired', Date.now() - 5000); // 5s ago, TTL=1s
    await expiredAdapter.save(expired);
    expect(await expiredAdapter.findOne('expired')).toBeUndefined();
    const all = await expiredAdapter.findAll();
    expect(all.find((p) => p.token === 'expired')).toBeUndefined();
  });

  it('clear removes all profile files', async () => {
    await adapter.save(makeProfile('x'));
    await adapter.save(makeProfile('y'));
    await adapter.clear();

    const files = await fs.promises.readdir(dir);
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('findAll applies method filter', async () => {
    const get = makeProfile('get');
    get.request.method = 'GET';
    const post = makeProfile('post');
    post.request.method = 'POST';
    await adapter.save(get);
    await adapter.save(post);

    const results = await adapter.findAll({ method: 'POST' });
    expect(results.every((p) => p.request.method === 'POST')).toBe(true);
  });

  it('reconstructs index from disk on new adapter instance', async () => {
    await adapter.save(makeProfile('persist1'));
    await adapter.save(makeProfile('persist2'));

    const newAdapter = new FileStorageAdapter({ storagePath: dir });
    const all = await newAdapter.findAll();
    const tokens = all.map((p) => p.token);
    expect(tokens).toContain('persist1');
    expect(tokens).toContain('persist2');
  });

  it('discovers profiles written by another process without restarting', async () => {
    // The adapter has already initialised its index from disk…
    await adapter.save(makeProfile('server-side'));

    // …then a separate process (e.g. a CLI command run) writes a profile file directly.
    const external = makeProfile('cli-cmd', Date.now() + 50);
    await fs.promises.writeFile(path.join(dir, 'cli-cmd.json'), JSON.stringify(external), 'utf-8');

    const all = await adapter.findAll();
    expect(all.map((p) => p.token)).toContain('cli-cmd');
    expect(await adapter.findOne('cli-cmd')).toBeDefined();
  });

  it('drops profiles whose files were removed externally', async () => {
    await adapter.save(makeProfile('gone'));
    await fs.promises.unlink(path.join(dir, 'gone.json'));

    expect(await adapter.findOne('gone')).toBeUndefined();
    expect((await adapter.findAll()).map((p) => p.token)).not.toContain('gone');
  });

  it('storageDirectory returns the resolved path', () => {
    expect(adapter.storageDirectory).toBe(dir);
  });

  it('defaults storagePath to ".profiler" resolved from cwd', () => {
    const defaultAdapter = new FileStorageAdapter();
    expect(defaultAdapter.storageDirectory).toBe(path.join(process.cwd(), '.profiler'));
  });

  it('cleans up expired files found on disk during load', async () => {
    // Write an already-expired profile file directly, bypassing save()'s eviction.
    const expired = makeProfile('stale', Date.now() - 5000);
    await fs.promises.writeFile(path.join(dir, 'stale.json'), JSON.stringify(expired), 'utf-8');

    const freshAdapter = new FileStorageAdapter({ storagePath: dir, ttl: 1 });
    expect(await freshAdapter.findAll()).toEqual([]);

    const files = await fs.promises.readdir(dir);
    expect(files).not.toContain('stale.json');
  });

  it('ignores malformed JSON files when loading from disk', async () => {
    await fs.promises.writeFile(path.join(dir, 'broken.json'), '{ not valid json', 'utf-8');
    await adapter.save(makeProfile('good'));

    const reloaded = new FileStorageAdapter({ storagePath: dir });
    const tokens = (await reloaded.findAll()).map((p) => p.token);
    expect(tokens).toContain('good');
    expect(tokens).not.toContain('broken');
  });

  it('removes stale temp files left by a crashed process during load', async () => {
    await fs.promises.writeFile(path.join(dir, 'crashed.json.tmp'), '{"partial":', 'utf-8');

    const freshAdapter = new FileStorageAdapter({ storagePath: dir });
    await freshAdapter.findAll();

    const files = await fs.promises.readdir(dir);
    expect(files).not.toContain('crashed.json.tmp');
  });

  describe('concurrency', () => {
    let bigAdapter: FileStorageAdapter;

    beforeEach(() => {
      bigAdapter = new FileStorageAdapter({ storagePath: dir, maxProfiles: 100, ttl: 3600 });
    });

    it('lists every profile after a burst of parallel saves interleaved with findAll', async () => {
      const base = Date.now();
      const saves = Array.from({ length: 50 }, (_, i) =>
        bigAdapter.save(makeProfile(`burst-${i}`, base + i)),
      );
      // Interleave reads with the writes, like list renders during traffic.
      const reads = Array.from({ length: 5 }, () => bigAdapter.findAll());
      await Promise.all([...saves, ...reads]);

      const all = await bigAdapter.findAll();
      const tokens = all.map((p) => p.token);
      expect(tokens).toHaveLength(50);
      expect(new Set(tokens).size).toBe(50);

      const files = await fs.promises.readdir(dir);
      expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(50);
      expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
    });

    it('does not drop entries saved while cross-process files appear', async () => {
      const base = Date.now();
      const saves = Array.from({ length: 20 }, (_, i) =>
        bigAdapter.save(makeProfile(`local-${i}`, base + i)),
      );
      // Another process writes files directly mid-burst.
      const externals = Array.from({ length: 5 }, (_, i) =>
        fs.promises.writeFile(
          path.join(dir, `ext-${i}.json`),
          JSON.stringify(makeProfile(`ext-${i}`, base + 100 + i)),
          'utf-8',
        ),
      );
      await Promise.all([...saves, ...externals]);

      const tokens = (await bigAdapter.findAll()).map((p) => p.token);
      for (let i = 0; i < 20; i++) expect(tokens).toContain(`local-${i}`);
      for (let i = 0; i < 5; i++) expect(tokens).toContain(`ext-${i}`);
    });

    it('keeps exactly the newest profiles when evicting under concurrent saves', async () => {
      const small = new FileStorageAdapter({ storagePath: dir, maxProfiles: 10, ttl: 3600 });
      const base = Date.now();
      await Promise.all(
        Array.from({ length: 30 }, (_, i) => small.save(makeProfile(`evict-${i}`, base + i))),
      );

      const all = await small.findAll();
      const tokens = all.map((p) => p.token);
      expect(tokens).toHaveLength(10);
      expect(tokens).toEqual(Array.from({ length: 10 }, (_, i) => `evict-${29 - i}`));

      const files = await fs.promises.readdir(dir);
      expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(10);
    });

    it('clear racing parallel saves leaves index and disk consistent', async () => {
      const base = Date.now();
      const saves = Array.from({ length: 20 }, (_, i) =>
        bigAdapter.save(makeProfile(`race-${i}`, base + i)),
      );
      const clearing = bigAdapter.clear();
      await Promise.all([...saves, clearing]);

      const tokens = (await bigAdapter.findAll()).map((p) => p.token).sort();
      const files = (await fs.promises.readdir(dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .sort();
      expect(tokens).toEqual(files);
    });

    it('serves repeated reads from the cache without re-reading files', async () => {
      await bigAdapter.save(makeProfile('cached'));
      await bigAdapter.findAll(); // warm

      const readSpy = jest.spyOn(fs.promises, 'readFile');
      const all = await bigAdapter.findAll();
      expect(all.map((p) => p.token)).toContain('cached');
      expect(readSpy).not.toHaveBeenCalled();
      readSpy.mockRestore();
    });

    it('invalidates the cache when a file is rewritten externally', async () => {
      const original = makeProfile('rewritten');
      await bigAdapter.save(original);
      await bigAdapter.findAll(); // warm

      const updated = makeProfile('rewritten', original.createdAt);
      updated.request.url = '/changed-externally';
      const filePath = path.join(dir, 'rewritten.json');
      await fs.promises.writeFile(filePath, JSON.stringify(updated), 'utf-8');
      // Force a different mtime even on coarse-grained filesystems.
      const future = new Date(Date.now() + 5000);
      await fs.promises.utimes(filePath, future, future);

      const found = await bigAdapter.findOne('rewritten');
      expect(found?.request.url).toBe('/changed-externally');
    });

    it('never surfaces a partially written profile to concurrent readers', async () => {
      // A profile large enough that a non-atomic write would be observable mid-flight.
      const big = makeProfile('huge', Date.now());
      big.request.body = 'x'.repeat(2 * 1024 * 1024);

      const save = bigAdapter.save(big);
      const reads = Array.from({ length: 10 }, () => bigAdapter.findOne('huge'));
      const results = await Promise.all(reads);
      await save;

      // Each concurrent read either misses (not yet renamed) or gets the complete profile.
      for (const r of results) {
        if (r !== undefined) expect((r.request.body as string).length).toBe(2 * 1024 * 1024);
      }
      const final = await bigAdapter.findOne('huge');
      expect((final?.request.body as string).length).toBe(2 * 1024 * 1024);
    });
  });
});
