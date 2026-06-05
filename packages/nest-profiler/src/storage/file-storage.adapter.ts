import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Profile } from '../interfaces/profile.interface';
import type { IProfilerStorageAdapter, StorageFindOptions } from './storage-adapter.interface';
import { applyProfileFilters } from './storage-filters';

export interface FileStorageAdapterOptions {
  /** Directory where profile files are stored. Defaults to '.profiler' in cwd. */
  storagePath?: string;
  /** Maximum number of profiles kept on disk (LRU eviction). Default: 100 */
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
  /** In-memory index of stored profiles sorted by createdAt ASC (oldest first). */
  private index: ProfileIndex[] = [];
  private ready: Promise<void> | null = null;

  constructor(options: FileStorageAdapterOptions = {}) {
    const rawPath = options.storagePath ?? '.profiler';
    this.dir = path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
    this.maxProfiles = options.maxProfiles ?? 100;
    this.ttlMs = (options.ttl ?? 3600) * 1000;
  }

  async save(profile: Profile): Promise<void> {
    await this.init();

    const filePath = this.tokenPath(profile.token);
    await fs.promises.writeFile(filePath, JSON.stringify(profile), 'utf-8');

    // Update index (avoid duplicates)
    this.index = this.index.filter((e) => e.token !== profile.token);
    this.index.push({ token: profile.token, createdAt: profile.createdAt });

    await this.evictExpiredAndOverflow();
  }

  async findAll(options?: StorageFindOptions): Promise<Profile[]> {
    await this.init();
    await this.syncIndex();

    const now = Date.now();
    const validEntries = this.index.filter((e) => now - e.createdAt < this.ttlMs).reverse(); // newest first

    const profiles = (await Promise.all(validEntries.map((e) => this.readProfile(e.token)))).filter(
      (p): p is Profile => p !== null,
    );

    return applyProfileFilters(profiles, options);
  }

  async findOne(token: string): Promise<Profile | undefined> {
    await this.init();
    await this.syncIndex();

    const entry = this.index.find((e) => e.token === token);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt >= this.ttlMs) return undefined;

    return (await this.readProfile(token)) ?? undefined;
  }

  async clear(): Promise<void> {
    await this.init();

    await Promise.all(
      this.index.map((e) => fs.promises.unlink(this.tokenPath(e.token)).catch(() => undefined)),
    );
    this.index = [];
  }

  /** Absolute path to the directory where profiles are stored. */
  get storageDirectory(): string {
    return this.dir;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private init(): Promise<void> {
    this.ready ??= this.loadFromDisk();
    return this.ready;
  }

  private async loadFromDisk(): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });

    const files = await fs.promises.readdir(this.dir).catch(() => null);
    if (files === null) return;

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

    // Sort oldest-first for LRU tracking
    this.index = entries.sort((a, b) => a.createdAt - b.createdAt);

    // Cleanup expired files silently
    const now = Date.now();
    const expired = this.index.filter((e) => now - e.createdAt >= this.ttlMs);
    await Promise.all(
      expired.map((e) => fs.promises.unlink(this.tokenPath(e.token)).catch(() => undefined)),
    );
    this.index = this.index.filter((e) => now - e.createdAt < this.ttlMs);
  }

  /**
   * Reconciles the in-memory index with the directory contents. This makes profiles written
   * by another process — e.g. a CLI command run while the web server is up — visible without
   * a restart, and drops entries whose files were removed externally. Cheap: a single
   * `readdir`, plus one read per newly discovered token.
   */
  private async syncIndex(): Promise<void> {
    const files = await fs.promises.readdir(this.dir).catch(() => null);
    if (files === null) return;

    const tokensOnDisk = new Set(
      files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
    );

    // Drop entries whose files were removed externally.
    this.index = this.index.filter((e) => tokensOnDisk.has(e.token));

    // Add entries for files created by other processes.
    const known = new Set(this.index.map((e) => e.token));
    const newTokens = [...tokensOnDisk].filter((t) => !known.has(t));
    if (newTokens.length === 0) return;

    const added = (
      await Promise.all(
        newTokens.map(async (token) => {
          const profile = await this.readProfile(token);
          return profile ? { token, createdAt: profile.createdAt } : null;
        }),
      )
    ).filter((e): e is ProfileIndex => e !== null);

    if (added.length > 0) {
      this.index.push(...added);
      this.index.sort((a, b) => a.createdAt - b.createdAt); // keep oldest-first for LRU
    }
  }

  private async readProfile(token: string): Promise<Profile | null> {
    try {
      const raw = await fs.promises.readFile(this.tokenPath(token), 'utf-8');
      return JSON.parse(raw) as Profile;
    } catch {
      return null;
    }
  }

  private tokenPath(token: string): string {
    return path.join(this.dir, `${token}.json`);
  }

  private async evictExpiredAndOverflow(): Promise<void> {
    const now = Date.now();

    // Remove expired
    const expired = this.index.filter((e) => now - e.createdAt >= this.ttlMs);
    for (const e of expired) {
      await fs.promises.unlink(this.tokenPath(e.token)).catch(() => undefined);
    }
    this.index = this.index.filter((e) => now - e.createdAt < this.ttlMs);

    // LRU: remove oldest until under limit
    while (this.index.length > this.maxProfiles) {
      const oldest = this.index.shift();
      if (oldest) {
        await fs.promises.unlink(this.tokenPath(oldest.token)).catch(() => undefined);
      }
    }
  }
}
