import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Profile } from '../interfaces/profile.interface';
import type { IProfilerStorageAdapter, StorageFindOptions } from './storage-adapter.interface';
import { applyProfileFilters } from './storage-filters';
import type { IndexAttributesProvider, ProfileSummary, SummaryPrimitive } from './profile-summary';
import { summarizeProfile } from './profile-summary';
import type { ProfilerPage, ProfilerQuery } from './profiler-query';
import { distinctFromSummaries, selectPage } from './profiler-query';

export interface FileStorageAdapterOptions {
  /** Directory where profile files are stored. Defaults to '.profiler' in cwd. */
  storagePath?: string;
  /**
   * Maximum number of profiles kept on disk (LRU eviction). Default: 100. Set to `0` (or negative)
   * for no cap.
   *
   * Also bounds the in-memory summary index and parsed-profile cache, so steady-state
   * memory grows with `maxProfiles × average summary/profile size`.
   */
  maxProfiles?: number;
  /** Profile TTL in seconds. Default: 3600 (1h). Set to `0` (or negative) to never expire. */
  ttl?: number;
}

/**
 * Sidecar file holding the queryable {@link ProfileSummary} of every stored profile,
 * so a fresh process can rebuild its index (and serve `query`/`distinct`) without
 * reading and parsing every profile. Not a `.json` file so it is never mistaken for a
 * profile (whose filename is `<token>.json`); the directory listing stays authoritative.
 */
const INDEX_FILE = '_index.meta';

export class FileStorageAdapter implements IProfilerStorageAdapter {
  /** Profiles are persisted as files on a shared filesystem — visible across processes. */
  readonly crossProcess = true;
  private readonly dir: string;
  private readonly maxProfiles: number;
  private readonly ttlMs: number;
  /**
   * In-memory index of stored profiles keyed by token, holding each profile's queryable
   * {@link ProfileSummary}. Filtering/sorting/pagination run over these summaries, so a
   * list render reads only the profile files of the requested page.
   */
  private readonly index = new Map<string, ProfileSummary>();
  /**
   * Parsed profiles keyed by token, validated against the file's mtime on every read, so a
   * read costs one stat instead of re-reading and parsing the file. Bounded by construction:
   * pruned wherever index entries are pruned, so it never exceeds `maxProfiles`.
   */
  private readonly cache = new Map<string, { mtimeMs: number; profile: Profile }>();
  /** Projection for kind-specific summary attributes; set by the profiler at startup. */
  private getAttributes?: IndexAttributesProvider;
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

  setIndexAttributesProvider(provider: IndexAttributesProvider): void {
    this.getAttributes = provider;
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

      this.index.set(profile.token, this.summarize(profile));

      // Prime the cache with the live object so the next read is a pure cache hit.
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (stat) this.cache.set(profile.token, { mtimeMs: stat.mtimeMs, profile });

      await this.evictExpiredAndOverflow();
      await this.persistIndex();
    });
  }

  async findAll(options?: StorageFindOptions): Promise<Profile[]> {
    await this.init();
    const tokens = await this.withLock(async () => {
      await this.syncIndex();
      // Newest first, matching the in-memory adapter and the list's default order.
      return this.validSummaries()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => s.token);
    });

    // File reads happen outside the lock so list rendering never serializes behind a
    // burst of saves; an entry evicted meanwhile simply reads as null and is dropped.
    const profiles = (await Promise.all(tokens.map((t) => this.readProfile(t)))).filter(
      (p): p is Profile => p !== null,
    );

    return applyProfileFilters(profiles, options);
  }

  async query(query: ProfilerQuery): Promise<ProfilerPage> {
    await this.init();
    // Filter/sort/paginate over the in-memory summaries under the lock, then read only
    // the page's profile files — the whole point of the sidecar index.
    const page = await this.withLock(async () => {
      await this.syncIndex();
      const entries = this.validSummaries().map((summary) => ({ summary, value: summary.token }));
      return selectPage(entries, query);
    });

    const items = (await Promise.all(page.items.map((t) => this.readProfile(t)))).filter(
      (p): p is Profile => p !== null,
    );
    return { items, total: page.total };
  }

  async querySummaries(query: ProfilerQuery): Promise<ProfileSummary[]> {
    await this.init();
    // Filter/sort/paginate over the in-memory summaries only — no profile files are read,
    // which is the whole point of an aggregation over the sidecar index.
    return this.withLock(async () => {
      await this.syncIndex();
      const entries = this.validSummaries().map((summary) => ({ summary, value: summary }));
      return selectPage(entries, query).items;
    });
  }

  async distinct(field: string, typeIn?: string[]): Promise<SummaryPrimitive[]> {
    await this.init();
    return this.withLock(async () => {
      await this.syncIndex();
      return distinctFromSummaries(this.validSummaries(), field, typeIn);
    });
  }

  async findOne(token: string): Promise<Profile | undefined> {
    await this.init();
    const summary = await this.withLock(async () => {
      await this.syncIndex();
      return this.index.get(token);
    });

    if (!summary) return undefined;
    if (this.isExpired(summary.createdAt)) return undefined;

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
      await fs.promises.unlink(this.indexPath()).catch(() => undefined);
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

  private summarize(profile: Profile): ProfileSummary {
    return summarizeProfile(profile, this.getAttributes);
  }

  /** Whether a profile has outlived the TTL. A non-positive TTL disables expiry. */
  private isExpired(createdAt: number): boolean {
    return this.ttlMs > 0 && Date.now() - createdAt >= this.ttlMs;
  }

  /** TTL-valid summaries from the in-memory index. */
  private validSummaries(): ProfileSummary[] {
    return [...this.index.values()].filter((s) => !this.isExpired(s.createdAt));
  }

  private indexPath(): string {
    return path.join(this.dir, INDEX_FILE);
  }

  /** Seeds the in-memory index from the sidecar file, if present and parseable. */
  private async loadIndexFile(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.indexPath(), 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, ProfileSummary>;
      for (const [token, summary] of Object.entries(parsed)) this.index.set(token, summary);
    } catch {
      // Missing or corrupt sidecar — the index is rebuilt from the profile files below.
    }
  }

  /** Atomically writes the current index to the sidecar file (write-then-rename). */
  private async persistIndex(): Promise<void> {
    const obj = Object.fromEntries(this.index);
    const tmpPath = `${this.indexPath()}.tmp`;
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(obj), 'utf-8');
      await fs.promises.rename(tmpPath, this.indexPath());
    } catch {
      // Best-effort cache: a failed sidecar write is recovered by readdir reconciliation.
    }
  }

  private async loadFromDisk(): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });

    await this.loadIndexFile();

    const files = await fs.promises.readdir(this.dir).catch(() => null);
    if (files === null) return;

    // Remove temp files left behind by a process that crashed mid-save.
    await Promise.all(
      files
        .filter((f) => f.endsWith('.json.tmp'))
        .map((f) => fs.promises.unlink(path.join(this.dir, f)).catch(() => undefined)),
    );

    const tokensOnDisk = new Set(
      files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
    );

    // Drop index entries whose files are gone, then summarize any files not yet indexed
    // (a stale/missing sidecar, or profiles written by another process).
    let changed = false;
    for (const token of this.index.keys()) {
      if (!tokensOnDisk.has(token)) {
        this.index.delete(token);
        this.cache.delete(token);
        changed = true;
      }
    }
    const missing = [...tokensOnDisk].filter((t) => !this.index.has(t));
    const summarized = await Promise.all(
      missing.map(async (token) => {
        const profile = await this.readProfile(token);
        return profile ? this.summarize(profile) : null;
      }),
    );
    for (const summary of summarized) {
      if (summary) {
        this.index.set(summary.token, summary);
        changed = true;
      }
    }

    // Clean up expired profiles found on disk.
    const expired = [...this.index.values()].filter((s) => this.isExpired(s.createdAt));
    if (expired.length > 0) {
      changed = true;
      for (const s of expired) {
        this.index.delete(s.token);
        this.cache.delete(s.token);
      }
      await Promise.all(
        expired.map((s) => fs.promises.unlink(this.tokenPath(s.token)).catch(() => undefined)),
      );
    }

    if (changed) await this.persistIndex();
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

    let changed = false;

    // Drop entries whose files were removed externally.
    for (const token of this.index.keys()) {
      if (!tokensOnDisk.has(token)) {
        this.index.delete(token);
        this.cache.delete(token);
        changed = true;
      }
    }

    // Add entries for files created by other processes.
    const newTokens = [...tokensOnDisk].filter((t) => !this.index.has(t));
    if (newTokens.length > 0) {
      const added = await Promise.all(
        newTokens.map(async (token) => {
          const profile = await this.readProfile(token);
          return profile ? this.summarize(profile) : null;
        }),
      );
      for (const summary of added) {
        if (summary) {
          this.index.set(summary.token, summary);
          changed = true;
        }
      }
    }

    if (changed) await this.persistIndex();
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
    // Defence in depth against path traversal: the token becomes a filename, so reject any
    // token that is not a plain safe id. Tokens are internal UUIDs, but a custom entrypoint
    // or a future code path could feed a hostile value (`../../evil`); this guarantees writes
    // and reads never escape the storage directory.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(token)) {
      throw new Error(`Invalid profile token: ${JSON.stringify(token)}`);
    }
    return path.join(this.dir, `${token}.json`);
  }

  /**
   * Drops expired entries and enforces the `maxProfiles` cap. Runs inside save()'s critical
   * section; victims are removed from the index first, then unlinked in parallel, so the
   * index never references a file scheduled for deletion. No filesystem work in the common
   * case where nothing is expired or over the limit.
   */
  private async evictExpiredAndOverflow(): Promise<void> {
    const victims = [...this.index.values()]
      .filter((s) => this.isExpired(s.createdAt))
      .map((s) => s.token);

    // A non-positive cap disables overflow eviction (unbounded).
    const liveCount = this.index.size - victims.length;
    if (this.maxProfiles > 0 && liveCount > this.maxProfiles) {
      const expired = new Set(victims);
      const live = [...this.index.values()]
        .filter((s) => !expired.has(s.token))
        .sort((a, b) => a.createdAt - b.createdAt); // oldest first
      victims.push(...live.slice(0, liveCount - this.maxProfiles).map((s) => s.token));
    }

    if (victims.length === 0) return;

    for (const token of victims) {
      this.index.delete(token);
      this.cache.delete(token);
    }
    await Promise.all(
      victims.map((token) => fs.promises.unlink(this.tokenPath(token)).catch(() => undefined)),
    );
  }
}
