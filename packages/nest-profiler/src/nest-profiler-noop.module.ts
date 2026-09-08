import { DynamicModule, Module } from '@nestjs/common';
import { TracerService } from './services/tracer.service';

/**
 * A standalone no-op counterpart to {@link ProfilerModule} that provides and exports
 * {@link TracerService}.
 *
 * There is no second "noop" implementation behind it, and that is the point: `TracerService`
 * injects nothing but optional dependencies, so provided on its own — with no `ClsModule`, no
 * core — it resolves and every method is already the no-op it is documented to be. The disabled
 * path therefore costs one object allocation and pulls in no dependency at all.
 *
 * **Opt-in** — you only need it when your app injects `TracerService` **directly**. Log capture
 * goes through the DI-free {@link createProfilerLogger}, so an app that only captures logs and
 * reads collector panels never resolves the service and does not need this module.
 *
 * When you do inject it, pair this with `ConditionalModule.registerWhen` as the fallback so the
 * injection still resolves when the profiler is disabled:
 *
 * @example
 * ```ts
 * ConditionalModule.registerWhen(ProfilerModule.forRootAsync({ isGlobal: true, ... }), isProfilerEnabled),
 * ConditionalModule.registerWhen(ProfilerNoopModule.forRoot({ isGlobal: true }), (env) => !isProfilerEnabled(env)),
 * ```
 */
@Module({})
export class ProfilerNoopModule {
  static forRoot({ isGlobal = false }: { isGlobal?: boolean } = {}): DynamicModule {
    return {
      module: ProfilerNoopModule,
      global: isGlobal,
      providers: [TracerService],
      exports: [TracerService],
    };
  }
}
