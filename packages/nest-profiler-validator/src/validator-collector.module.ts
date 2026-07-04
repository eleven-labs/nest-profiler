import { APP_PIPE } from '@nestjs/core';
import { DynamicModule, Logger, Module } from '@nestjs/common';
import type { PipeTransform, ValidationPipeOptions } from '@nestjs/common';
import { ValidatorCollector } from './validator.collector';
import { ProfilerValidationPipe } from './profiler-validation.pipe';
import { PROFILER_INNER_PIPE, PROFILER_EXTRACTORS } from './validator-collector.interface';
import type { ValidationViolationExtractor } from './violation-extractor.interface';
import { DEFAULT_EXTRACTORS } from './default-extractors';
import { createClassValidatorPipe } from './class-validator.adapter';

export interface ValidatorCollectorModuleOptions {
  /**
   * Enable the collector. Default: `true`. Set to `false` to disable *profiling* only: the
   * global validation pipe (your `pipe`, or the default class-validator one) is still
   * installed — just without the profiler wrapper — so disabling the profiler never removes
   * input validation.
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
    // Disabling turns off *profiling*, not validation. Because this module is the host's
    // installation vector for the global validation pipe, `enabled: false` still installs the
    // bare inner pipe (no profiler wrapper, no collector) so toggling the profiler off — e.g.
    // in production — never silently removes input validation (a mass-assignment footgun).
    if (options.enabled === false) {
      const pipe = ValidatorCollectorModule.resolveInnerPipe(options);
      if (!pipe) return { module: ValidatorCollectorModule };
      return {
        module: ValidatorCollectorModule,
        providers: [{ provide: APP_PIPE, useValue: pipe }],
      };
    }

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

  /**
   * The bare validation pipe to keep installed when the collector is disabled: the caller's
   * `pipe`, else a default class-validator pipe. Returns `undefined` (with a warning) when
   * neither is available, so a missing `class-validator` peer degrades to "no validation
   * installed" rather than crashing the bootstrap.
   */
  private static resolveInnerPipe(
    options: ValidatorCollectorModuleOptions,
  ): PipeTransform | undefined {
    if (options.pipe) return options.pipe;
    try {
      return createClassValidatorPipe(options.validationPipeOptions);
    } catch {
      new Logger(ValidatorCollectorModule.name).warn(
        'Profiler validator disabled and no validation pipe is available (provide `pipe` or ' +
          'install class-validator/class-transformer) — global validation is NOT installed.',
      );
      return undefined;
    }
  }
}
