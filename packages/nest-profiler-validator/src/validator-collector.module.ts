import { APP_PIPE } from '@nestjs/core';
import { DynamicModule, Module } from '@nestjs/common';
import type { PipeTransform, ValidationPipeOptions } from '@nestjs/common';
import { ValidatorCollector } from './validator.collector';
import { ProfilerValidationPipe } from './profiler-validation.pipe';
import { PROFILER_INNER_PIPE, PROFILER_EXTRACTORS } from './validator-collector.interface';
import type { ValidationViolationExtractor } from './violation-extractor.interface';
import { DEFAULT_EXTRACTORS } from './default-extractors';
import { createClassValidatorPipe } from './class-validator.adapter';

export interface ValidatorCollectorModuleOptions {
  /**
   * Enable the collector. Default: `true`. Set to `false` to disable entirely
   * (no global pipe is installed — the host application decides per environment).
   */
  enabled?: boolean;
  /**
   * The validation pipe to wrap and install as the global pipe. Provide your
   * validator's pipe here (e.g. `new ZodValidationPipe()` from nestjs-zod).
   * When omitted, a class-validator `ValidationPipe` is built from
   * `validationPipeOptions` (requires `class-validator` + `class-transformer`).
   */
  pipe?: PipeTransform;
  /** Options forwarded to the default class-validator pipe when `pipe` is not provided. */
  validationPipeOptions?: ValidationPipeOptions;
  /**
   * Override the violation extractor chain. Defaults to
   * `[classValidatorExtractor, zodExtractor, genericExtractor]`.
   */
  extractors?: ValidationViolationExtractor[];
}

@Module({})
export class ValidatorCollectorModule {
  /**
   * Registers ValidatorCollector and installs ProfilerValidationPipe as the
   * global APP_PIPE, wrapping the configured pipe (or a default class-validator
   * pipe). The default pipe is only constructed when `options.pipe` is omitted,
   * so applications using another validator never load class-validator.
   *
   * @param options - validator-agnostic collector options
   */
  static forRoot(options: ValidatorCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: ValidatorCollectorModule };
    return {
      module: ValidatorCollectorModule,
      providers: [
        {
          provide: PROFILER_INNER_PIPE,
          useValue: options.pipe ?? createClassValidatorPipe(options.validationPipeOptions),
        },
        { provide: PROFILER_EXTRACTORS, useValue: options.extractors ?? DEFAULT_EXTRACTORS },
        ValidatorCollector,
        ProfilerValidationPipe,
        { provide: APP_PIPE, useExisting: ProfilerValidationPipe },
      ],
    };
  }
}
