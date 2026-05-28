import type { Profile } from '../interfaces/profile.interface';
import type { IProfilerStorageAdapter, StorageFindOptions } from './storage-adapter.interface';
import { applyProfileFilters } from './storage-filters';

export interface MemoryStorageAdapterOptions {
  maxProfiles?: number;
  ttl?: number;
}

export class MemoryStorageAdapter implements IProfilerStorageAdapter {
  private readonly maxProfiles: number;
  private readonly ttl: number;
  private readonly profiles = new Map<string, Profile>();

  constructor(options: MemoryStorageAdapterOptions = {}) {
    this.maxProfiles = options.maxProfiles ?? 100;
    this.ttl = (options.ttl ?? 3600) * 1000;
  }

  save(profile: Profile): void {
    if (this.profiles.size >= this.maxProfiles) {
      const oldest = this.profiles.keys().next().value;
      if (oldest !== undefined) {
        this.profiles.delete(oldest);
      }
    }
    this.profiles.set(profile.token, profile);
  }

  findAll(options?: StorageFindOptions): Profile[] {
    const now = Date.now();
    const valid = [...this.profiles.values()].filter((p) => now - p.createdAt < this.ttl);
    return applyProfileFilters(valid, options).reverse();
  }

  findOne(token: string): Profile | undefined {
    const profile = this.profiles.get(token);
    if (!profile) return undefined;
    if (Date.now() - profile.createdAt >= this.ttl) {
      this.profiles.delete(token);
      return undefined;
    }
    return profile;
  }

  clear(): void {
    this.profiles.clear();
  }
}
