import { DynamicModule, Module } from '@nestjs/common';
import { ProfilerService } from './services/nest-profiler.service';
import { NoopProfilerService } from './services/noop-profiler.service';

/**
 * A standalone no-op counterpart to {@link ProfilerModule} that provides and
 * exports {@link ProfilerService} bound to the zero-dependency
 * {@link NoopProfilerService}.
 *
 * Pair it with `ConditionalModule.registerWhen` as the fallback when the
 * profiler is disabled:
 *
 * @example
 * ```ts
 * ConditionalModule.registerWhen(ProfilerModule.forRootAsync({ isGlobal: true, ... }), isProfilerEnabled),
 * ConditionalModule.registerWhen(ProfilerNoopModule.forRoot({ isGlobal: true }), (env) => !isProfilerEnabled(env)),
 * ```
 *
 * Unlike `ProfilerModule.forRoot({ enabled: false })` (whose inert layer is
 * still skipped entirely when its `ConditionalModule` condition is false), this
 * module guarantees `ProfilerService` stays injectable everywhere so consumers
 * never fail with "cannot resolve dependency ProfilerService". Because it binds
 * the no-op service it pulls in **no** dependencies (no `ClsModule`), so the
 * disabled path has no runtime cost.
 */
@Module({})
export class ProfilerNoopModule {
  static forRoot({ isGlobal = false }: { isGlobal?: boolean } = {}): DynamicModule {
    return {
      module: ProfilerNoopModule,
      global: isGlobal,
      providers: [{ provide: ProfilerService, useClass: NoopProfilerService }],
      exports: [ProfilerService],
    };
  }
}
