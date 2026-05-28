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
});
