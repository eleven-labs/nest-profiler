import { DynamicModule, Module } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape } from '@eleven-labs/nest-profiler';
import { ConfigurableModuleClass } from './auth-collector.interface';
import type {
  AuthCollectorModuleAsyncOptions,
  AuthCollectorModuleOptions,
} from './auth-collector.interface';
import { AuthCollector } from './auth.collector';

export { AUTH_COLLECTOR_OPTIONS } from './auth-collector.interface';
export type {
  AuthBadgeMode,
  AuthCollectorModuleOptions,
  AuthCollectorModuleAsyncOptions,
} from './auth-collector.interface';

const SHAPE: CollectorModuleShape = { providers: [AuthCollector] };

@Module({})
export class AuthCollectorModule extends ConfigurableModuleClass {
  static forRoot(options: AuthCollectorModuleOptions = {}): DynamicModule {
    return buildCollectorModule(super.forRoot(options), options, SHAPE);
  }

  /**
   * Async variant — resolve the options (e.g. `maskUserFields`) from DI such as `ConfigService`.
   * Gating stays the host's job via `ConditionalModule.registerWhen`.
   */
  static forRootAsync(options: AuthCollectorModuleAsyncOptions): DynamicModule {
    return buildCollectorModule(super.forRootAsync(options), options, SHAPE);
  }
}
