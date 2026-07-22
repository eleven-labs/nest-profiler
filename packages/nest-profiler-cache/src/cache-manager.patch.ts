import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry, nowMs, sinceMs, tryResolve } from '@eleven-labs/nest-profiler';
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
export class CacheManagerPatch implements OnModuleInit, OnModuleDestroy {
  /** Restores installed to undo the monkey-patch on shutdown (avoids leaking into e2e teardown). */
  private readonly restorers: (() => void)[] = [];
  /** Resolved lazily so a disabled core (no ClsModule) degrades to a no-op instead of a DI crash. */
  private cls: ClsService | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional() @Inject(CACHE_MANAGER) private readonly cacheManager: CacheManager,
  ) {}

  onModuleInit(): void {
    this.cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    if (!this.cacheManager || !this.cls) return;
    // Guard against re-patching (re-init, multiple cache stores) — mirrors the
    // ORM/axios patches. Without it, a second onModuleInit would wrap the
    // already-wrapped methods and record each operation twice.
    const guarded = this.cacheManager as CacheManager & { __profilerPatched?: boolean };
    if (guarded.__profilerPatched) return;
    guarded.__profilerPatched = true;
    this.patchMethod('get');
    this.patchMethod('set');
    this.patchMethod('del');
  }

  onModuleDestroy(): void {
    // Restore the original methods so a torn-down ClsService/manager isn't captured by lingering
    // closures (matters in e2e suites that create and destroy multiple apps).
    for (const restore of this.restorers.splice(0)) restore();
    if (this.cacheManager) {
      (this.cacheManager as CacheManager & { __profilerPatched?: boolean }).__profilerPatched =
        false;
    }
  }

  private patchMethod(method: 'get' | 'set' | 'del'): void {
    const manager = this.cacheManager;
    const original = manager[method].bind(manager) as PatchableMethod;
    const cls = this.cls;

    const patched: PatchableMethod = async function (...args: unknown[]): Promise<unknown> {
      const key = String(args[0]);
      const startedAt = nowMs();
      let result: unknown;
      let error: string | undefined;
      try {
        result = await original(...args);
        return result;
      } catch (err) {
        // Record cache-backend failures too (previously they were invisible) — then rethrow.
        error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const duration = sinceMs(startedAt);
        let operation: CacheOperationEntry['operation'];
        if (method === 'get') {
          operation =
            error === undefined && result !== undefined && result !== null ? 'GET_HIT' : 'GET_MISS';
        } else if (method === 'set') {
          operation = 'SET';
        } else {
          operation = 'DEL';
        }
        try {
          const profile = cls?.get<Profile | undefined>('profiler.profile');
          if (profile) {
            appendCollectorEntry<CacheOperationEntry>(profile, CACHE_OPERATIONS_KEY, {
              operation,
              key,
              duration,
              startedAt,
              error,
            });
          }
        } catch {
          // Outside CLS context
        }
      }
    };

    Reflect.set(manager, method, patched);
    this.restorers.push(() => Reflect.set(manager, method, original));
  }
}
