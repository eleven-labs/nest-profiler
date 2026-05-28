import type { Profile } from '../interfaces/profile.interface';

export const PROFILER_STORAGE_ADAPTER = Symbol('PROFILER_STORAGE_ADAPTER');

export interface StorageFindOptions {
  method?: string;
  statusCode?: number;
  minDuration?: number;
  maxDuration?: number;
  urlPattern?: string;
}

export interface IProfilerStorageAdapter {
  save(profile: Profile): Promise<void> | void;
  findAll(options?: StorageFindOptions): Promise<Profile[]> | Profile[];
  findOne(token: string): Promise<Profile | undefined> | Profile | undefined;
  clear(): Promise<void> | void;
}
