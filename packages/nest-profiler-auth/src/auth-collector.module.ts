import { DynamicModule, Module } from '@nestjs/common';
import { AuthCollector } from './auth.collector';

export interface AuthCollectorModuleOptions {
  maskUserFields?: string[];
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

export const AUTH_COLLECTOR_OPTIONS = Symbol('AUTH_COLLECTOR_OPTIONS');

@Module({})
export class AuthCollectorModule {
  static forRoot(options: AuthCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: AuthCollectorModule };
    return {
      module: AuthCollectorModule,
      providers: [{ provide: AUTH_COLLECTOR_OPTIONS, useValue: options }, AuthCollector],
    };
  }
}
