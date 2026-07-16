import { DynamicModule, Module } from '@nestjs/common';
import { ProfilerService } from './services/nest-profiler.service';
import { NoopProfilerService } from './services/noop-profiler.service';

/**
 * A standalone no-op counterpart to {@link ProfilerModule} that provides and
 * exports {@link ProfilerService} bound to the zero-dependency
 * {@link NoopProfilerService}.
 *
 * **Opt-in** — you only need it when your app injects `ProfilerService`
 * **directly** (`startSpan`, `addEvent`, `addException`, `setSecurityContext`,
 * `getCurrentToken`). Log capture goes through the DI-free
 * {@link createProfilerLogger}, so an app that only captures logs and reads
 * collector panels never resolves `ProfilerService` and does not need this.
 *
 * When you do inject it, pair this with `ConditionalModule.registerWhen` as the
 * fallback so the injection still resolves when the profiler is disabled:
 *
 * @example
 * ```ts
 * ConditionalModule.registerWhen(ProfilerModule.forRootAsync({ isGlobal: true, ... }), isProfilerEnabled),
 * ConditionalModule.registerWhen(ProfilerNoopModule.forRoot({ isGlobal: true }), (env) => !isProfilerEnabled(env)),
 * ```
 *
 * Because it binds the no-op service it pulls in **no** dependencies (no
 * `ClsModule`), so the disabled path has no runtime cost.
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
