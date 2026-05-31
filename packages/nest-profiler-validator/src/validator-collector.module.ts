import { APP_PIPE } from '@nestjs/core';
import { DynamicModule, Module } from '@nestjs/common';
import type { ValidationPipeOptions } from '@nestjs/common';
import { ValidatorCollector } from './validator.collector';
import { ProfilerValidationPipe } from './profiler-validation.pipe';
import { PROFILER_VALIDATION_OPTIONS } from './validator-collector.interface';

export { PROFILER_VALIDATION_OPTIONS };

export interface ValidatorCollectorModuleOptions extends ValidationPipeOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

@Module({})
export class ValidatorCollectorModule {
  /**
   * Registers ValidatorCollector and installs ProfilerValidationPipe as the
   * global APP_PIPE, replacing ValidationPipe.
   *
   * @param options - forwarded to ValidationPipe (whitelist, transform, etc.)
   */
  static forRoot(options: ValidatorCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: ValidatorCollectorModule };
    return {
      module: ValidatorCollectorModule,
      providers: [
        { provide: PROFILER_VALIDATION_OPTIONS, useValue: options },
        ValidatorCollector,
        ProfilerValidationPipe,
        { provide: APP_PIPE, useExisting: ProfilerValidationPipe },
      ],
    };
  }
}
