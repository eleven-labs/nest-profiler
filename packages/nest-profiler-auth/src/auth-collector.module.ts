import { ConfigurableModuleBuilder, DynamicModule, Module } from '@nestjs/common';
import type { ConfigurableModuleAsyncOptions } from '@nestjs/common';
import { buildCollectorModule } from '@eleven-labs/nest-profiler';
import type { CollectorModuleShape, SecurityContext } from '@eleven-labs/nest-profiler';
import { AuthCollector } from './auth.collector';

/**
 * What the Security sidebar badge shows for an authenticated request.
 *
 * - `'status'` (default): a fixed, compact `auth` label — mirrors the `anon` shown when
 *   unauthenticated. The full identity stays in the panel detail.
 * - `'role'`: the first role (`admin`, `user`, …), falling back to `auth` when none is known.
 * - `'identifier'`: the legacy behaviour — `username ?? email ?? sub ?? id`, else `auth`.
 */
export type AuthBadgeMode = 'status' | 'role' | 'identifier';

export interface AuthCollectorModuleOptions {
  maskUserFields?: string[];
  /**
   * Badge content for authenticated requests. Default: `'status'`.
   * Ignored when {@link AuthCollectorModuleOptions.badgeValue} is provided.
   */
  badge?: AuthBadgeMode;
  /**
   * Custom badge resolver for authenticated requests, for full control. Takes precedence over
   * {@link AuthCollectorModuleOptions.badge}. Return `null` to hide the badge. Unauthenticated
   * requests always show `anon` and never reach this resolver.
   */
  badgeValue?: (security: SecurityContext) => string | null;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

/** Async configuration for {@link AuthCollectorModule.forRootAsync}. */
export type AuthCollectorModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<AuthCollectorModuleOptions> & {
    /** Synchronous enable flag (decided at module-build time, not by the factory). */
    enabled?: boolean;
  };

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: AUTH_COLLECTOR_OPTIONS } =
  new ConfigurableModuleBuilder<AuthCollectorModuleOptions>().setClassMethodName('forRoot').build();

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
