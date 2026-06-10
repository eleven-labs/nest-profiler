import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Profile } from '../interfaces/profile.interface';
import type { IProfilerStorageAdapter, StorageFindOptions } from './storage-adapter.interface';
import { applyProfileFilters } from './storage-filters';

export interface FileStorageAdapterOptions {
  /** Directory where profile files are stored. Defaults to '.profiler' in cwd. */
  storagePath?: string;
  /**
   * Maximum number of profiles kept on disk (LRU eviction). Default: 100
   *
   * Also bounds the in-memory cache of parsed profiles, so steady-state memory grows
   * with `maxProfiles × average profile size` (larger when `collectBody` is enabled).
   */
  maxProfiles?: number;
  /** Profile TTL in seconds. Default: 3600 (1h) */
  ttl?: number;
}

interface ProfileIndex {
  token: string;
  createdAt: number;
}

export class FileStorageAdapter implements IProfilerStorageAdapter {
  /** Profiles are persisted as files on a shared filesystem — visible across processes. */
  readonly crossProcess = true;
  private readonly dir: string;
  private readonly maxProfiles: number;
  private readonly ttlMs: number;
  /** In-memory index of stored profiles keyed by token — a Map cannot hold duplicates. */
  private readonly index = new Map<string, ProfileIndex>();
  /**
   * Parsed profiles keyed by token, validated against the file's mtime on every read, so a
   * list render costs one stat per profile instead of reading and parsing every file again.
   * Bounded by construction: entries are pruned exactly where index entries are pruned, so
   * the cache never exceeds `maxProfiles` profiles (worst-case memory: maxProfiles × profile
   * size). Cached profiles are returned by reference — treat them as read-only.
   */
  private readonly cache = new Map<string, { mtimeMs: number; profile: Profile }>();
  private ready: Promise<void> | null = null;
  /**
   * Serializes every index/disk mutation. Concurrent saves, directory syncs and evictions
   * interleave at their await points; without mutual exclusion a sync working from a stale
   * readdir snapshot can drop the entry of a save that completed in between, and overlapping
   * evictions can unlink files the index still references.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: FileStorageAdapterOptions = {}) {
    const rawPath = options.storagePath ?? '.profiler';
    this.dir = path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
    this.maxProfiles = options.maxProfiles ?? 100;
    this.ttlMs = (options.ttl ?? 3600) * 1000;
  }

  async save(profile: Profile): Promise<void> {
    await this.init();

    await this.withLock(async () => {
      const filePath = this.tokenPath(profile.token);
      // Write-then-rename so concurrent readers (this process or another) only ever see
      // the .json file absent or complete — never a partially written JSON document.
      const tmpPath = `${filePath}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(profile), 'utf-8');
      await fs.promises.rename(tmpPath, filePath);

      this.index.set(profile.token, { token: profile.token, createdAt: profile.createdAt });

      // Prime the cache with the live object so the next list render is a pure cache hit.
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (stat) this.cache.set(profile.token, { mtimeMs: stat.mtimeMs, profile });

      await this.evictExpiredAndOverflow();
    });
  }

  async findAll(options?: StorageFindOptions): Promise<Profile[]> {
    await this.init();
    const entries = await this.withLock(async () => {
      await this.syncIndex();
      return this.sortedEntries();
    });

    const now = Date.now();
    const validEntries = entries.filter((e) => now - e.createdAt < this.ttlMs).reverse(); // newest first

    // File reads happen outside the lock so list rendering never serializes behind a
    // burst of saves; an entry evicted meanwhile simply reads as null and is dropped.
    const profiles = (await Promise.all(validEntries.map((e) => this.readProfile(e.token)))).filter(
      (p): p is Profile => p !== null,
    );

    return applyProfileFilters(profiles, options);
  }

  async findOne(token: string): Promise<Profile | undefined> {
    await this.init();
    const entry = await this.withLock(async () => {
      await this.syncIndex();
      return this.index.get(token);
    });

    if (!entry) return undefined;
    if (Date.now() - entry.createdAt >= this.ttlMs) return undefined;

    return (await this.readProfile(token)) ?? undefined;
  }

  async clear(): Promise<void> {
    await this.init();

    await this.withLock(async () => {
      await Promise.all(
        [...this.index.keys()].map((token) =>
          fs.promises.unlink(this.tokenPath(token)).catch(() => undefined),
        ),
      );
      this.index.clear();
      this.cache.clear();
    });
  }

  /** Absolute path to the directory where profiles are stored. */
  get storageDirectory(): string {
    return this.dir;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Runs `fn` exclusively, after every previously queued operation has settled. */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    // Swallow the outcome so one failed operation never poisons the queue;
    // callers still observe it through `run`.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private init(): Promise<void> {
    this.ready ??= this.loadFromDisk();
    return this.ready;
  }

  private async loadFromDisk(): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });

    const files = await fs.promises.readdir(this.dir).catch(() => null);
    if (files === null) return;

    // Remove temp files left behind by a process that crashed mid-save.
    await Promise.all(
      files
        .filter((f) => f.endsWith('.json.tmp'))
        .map((f) => fs.promises.unlink(path.join(this.dir, f)).catch(() => undefined)),
    );

    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    const entries = (
      await Promise.all(
        jsonFiles.map(async (f) => {
          const token = f.slice(0, -5); // strip .json
          const profile = await this.readProfile(token);
          return profile ? { token, createdAt: profile.createdAt } : null;
        }),
      )
    ).filter((e): e is ProfileIndex => e !== null);

    entries.sort((a, b) => a.createdAt - b.createdAt);

    // Index valid entries; clean up expired files silently.
    const now = Date.now();
    const unlinks: Promise<unknown>[] = [];
    for (const e of entries) {
      if (now - e.createdAt >= this.ttlMs) {
        unlinks.push(fs.promises.unlink(this.tokenPath(e.token)).catch(() => undefined));
      } else {
        this.index.set(e.token, e);
      }
    }
    await Promise.all(unlinks);
  }

  /**
   * Reconciles the in-memory index with the directory contents. This makes profiles written
   * by another process — e.g. a CLI command run while the web server is up — visible without
   * a restart, and drops entries whose files were removed externally. Cheap: a single
   * `readdir`, plus one read per newly discovered token. Must run under the lock: saves are
   * then guaranteed not to land between the readdir snapshot and the pruning below, so a
   * freshly saved entry can never be pruned for being absent from a stale snapshot.
   */
  private async syncIndex(): Promise<void> {
    const files = await fs.promises.readdir(this.dir).catch(() => null);
    if (files === null) return;

    const tokensOnDisk = new Set(
      files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
    );

    // Drop entries whose files were removed externally.
    for (const token of this.index.keys()) {
      if (!tokensOnDisk.has(token)) {
        this.index.delete(token);
        this.cache.delete(token);
      }
    }

    // Add entries for files created by other processes.
    const newTokens = [...tokensOnDisk].filter((t) => !this.index.has(t));
    if (newTokens.length === 0) return;

    const added = (
      await Promise.all(
        newTokens.map(async (token) => {
          const profile = await this.readProfile(token);
          return profile ? { token, createdAt: profile.createdAt } : null;
        }),
      )
    ).filter((e): e is ProfileIndex => e !== null);

    for (const e of added) this.index.set(e.token, e);
  }

  private async readProfile(token: string): Promise<Profile | null> {
    const filePath = this.tokenPath(token);
    try {
      const stat = await fs.promises.stat(filePath);
      const cached = this.cache.get(token);
      if (cached?.mtimeMs === stat.mtimeMs) return cached.profile;

      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const profile = JSON.parse(raw) as Profile;
      this.cache.set(token, { mtimeMs: stat.mtimeMs, profile });
      return profile;
    } catch {
      this.cache.delete(token);
      return null;
    }
  }

  private tokenPath(token: string): string {
    return path.join(this.dir, `${token}.json`);
  }

  /** Index entries sorted oldest-first (LRU order). */
  private sortedEntries(): ProfileIndex[] {
    return [...this.index.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Drops expired entries and enforces the `maxProfiles` cap. Runs inside save()'s critical
   * section; victims are removed from the index first, then unlinked in parallel, so the
   * index never references a file scheduled for deletion. No filesystem work in the common
   * case where nothing is expired or over the limit.
   */
  private async evictExpiredAndOverflow(): Promise<void> {
    const now = Date.now();

    const victims = [...this.index.values()].filter((e) => now - e.createdAt >= this.ttlMs);

    const liveCount = this.index.size - victims.length;
    if (liveCount > this.maxProfiles) {
      const expired = new Set(victims.map((e) => e.token));
      const live = this.sortedEntries().filter((e) => !expired.has(e.token));
      victims.push(...live.slice(0, liveCount - this.maxProfiles));
    }

    if (victims.length === 0) return;

    for (const e of victims) {
      this.index.delete(e.token);
      this.cache.delete(e.token);
    }
    await Promise.all(
      victims.map((e) => fs.promises.unlink(this.tokenPath(e.token)).catch(() => undefined)),
    );
  }
}
