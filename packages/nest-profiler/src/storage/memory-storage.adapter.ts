import type { Profile } from '../interfaces/profile.interface';
import type { IProfilerStorageAdapter, StorageFindOptions } from './storage-adapter.interface';
import { applyProfileFilters } from './storage-filters';

export interface MemoryStorageAdapterOptions {
  /** Maximum profiles kept (LRU eviction). Default: 100. Set to `0` (or negative) for no cap. */
  maxProfiles?: number;
  /** Profile TTL in seconds. Default: 3600. Set to `0` (or negative) to never expire. */
  ttl?: number;
}

export class MemoryStorageAdapter implements IProfilerStorageAdapter {
  /** In-memory store — profiles live only in this process's heap. */
  readonly crossProcess = false;
  private readonly maxProfiles: number;
  private readonly ttlMs: number;
  private readonly profiles = new Map<string, Profile>();

  constructor(options: MemoryStorageAdapterOptions = {}) {
    this.maxProfiles = options.maxProfiles ?? 100;
    this.ttlMs = (options.ttl ?? 3600) * 1000;
  }

  /** Whether a profile has outlived the TTL. A non-positive TTL disables expiry. */
  private isExpired(createdAt: number): boolean {
    return this.ttlMs > 0 && Date.now() - createdAt >= this.ttlMs;
  }

  save(profile: Profile): void {
    // A non-positive cap disables eviction (unbounded). Only evict when adding a NEW token
    // would exceed the cap — re-saving an existing token (e.g. the GraphQL backfill) does not
    // grow the store, so it must not evict the oldest and shrink it below the cap.
    if (
      this.maxProfiles > 0 &&
      !this.profiles.has(profile.token) &&
      this.profiles.size >= this.maxProfiles
    ) {
      const oldest = this.profiles.keys().next().value;
      if (oldest !== undefined) {
        this.profiles.delete(oldest);
      }
    }
    this.profiles.set(profile.token, profile);
  }

  findAll(options?: StorageFindOptions): Profile[] {
    const valid = [...this.profiles.values()].filter((p) => !this.isExpired(p.createdAt));
    return applyProfileFilters(valid, options).reverse();
  }

  findOne(token: string): Profile | undefined {
    const profile = this.profiles.get(token);
    if (!profile) return undefined;
    if (this.isExpired(profile.createdAt)) {
      this.profiles.delete(token);
      return undefined;
    }
    return profile;
  }

  clear(): void {
    this.profiles.clear();
  }
}
