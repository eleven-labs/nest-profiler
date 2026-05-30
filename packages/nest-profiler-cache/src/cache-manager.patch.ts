import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import type { CacheOperationEntry } from './cache-collector.interface';
import { CACHE_OPERATIONS_KEY } from './cache-collector.interface';

/** Minimal cache manager surface required by this patch. Returns Promise<unknown> so the
 *  patch function (which also returns Promise<unknown>) can be assigned without casting. */
interface CacheManager {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttl?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

type PatchableMethod = (...args: unknown[]) => Promise<unknown>;

@Injectable()
export class CacheManagerPatch implements OnModuleInit {
  constructor(
    private readonly cls: ClsService,
    @Optional() @Inject(CACHE_MANAGER) private readonly cacheManager: CacheManager,
  ) {}

  onModuleInit(): void {
    if (!this.cacheManager) return;
    this.patchMethod('get');
    this.patchMethod('set');
    this.patchMethod('del');
  }

  private patchMethod(method: 'get' | 'set' | 'del'): void {
    const original = this.cacheManager[method].bind(this.cacheManager) as PatchableMethod;
    const cls = this.cls;

    const patched: PatchableMethod = async function (...args: unknown[]): Promise<unknown> {
      const key = String(args[0]);
      const startedAt = Date.now();
      const result = await original(...args);
      const duration = Date.now() - startedAt;

      let operation: CacheOperationEntry['operation'];
      if (method === 'get') {
        operation = result !== undefined && result !== null ? 'GET_HIT' : 'GET_MISS';
      } else if (method === 'set') {
        operation = 'SET';
      } else {
        operation = 'DEL';
      }

      try {
        const profile = cls.get<Profile | undefined>('profiler.profile');
        if (profile) {
          appendCollectorEntry<CacheOperationEntry>(profile, CACHE_OPERATIONS_KEY, {
            operation,
            key,
            duration,
            startedAt,
          });
        }
      } catch {
        // Outside CLS context
      }

      return result;
    };

    Reflect.set(this.cacheManager, method, patched);
  }
}
