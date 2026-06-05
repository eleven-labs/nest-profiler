import { Inject, Injectable, Optional } from '@nestjs/common';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';
import { PROFILER_STORAGE_ADAPTER } from '../storage/storage-adapter.interface';
import type {
  IProfilerStorageAdapter,
  StorageFindOptions,
} from '../storage/storage-adapter.interface';
import { MemoryStorageAdapter } from '../storage/memory-storage.adapter';

@Injectable()
export class ProfilerStorageService {
  private readonly adapter: IProfilerStorageAdapter;

  constructor(
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
    @Optional()
    @Inject(PROFILER_STORAGE_ADAPTER)
    adapter?: IProfilerStorageAdapter,
  ) {
    this.adapter =
      adapter ?? new MemoryStorageAdapter({ maxProfiles: options.maxProfiles, ttl: options.ttl });
  }

  /**
   * Whether the configured adapter persists profiles where another process can read them.
   * Defaults to `true` when the adapter does not declare the capability (custom adapters are
   * assumed to use a shared backing store).
   */
  get crossProcess(): boolean {
    return this.adapter.crossProcess ?? true;
  }

  save(profile: Profile): void | Promise<void> {
    return this.adapter.save(profile);
  }

  findAll(options?: StorageFindOptions): Profile[] | Promise<Profile[]> {
    return this.adapter.findAll(options);
  }

  findOne(token: string): Profile | undefined | Promise<Profile | undefined> {
    return this.adapter.findOne(token);
  }

  clear(): void | Promise<void> {
    return this.adapter.clear();
  }
}
