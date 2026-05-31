import { ArgumentMetadata, Inject, Injectable, Optional } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { ValidationPipeOptions } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { ValidatorOptions } from 'class-validator';
import type { ValidationError } from 'class-validator';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import type { ValidationEntry, ViolationEntry } from './validator-collector.interface';
import {
  VALIDATOR_KEY,
  VALIDATOR_PENDING_KEY,
  PROFILER_VALIDATION_OPTIONS,
} from './validator-collector.interface';

type Constructable = abstract new (...args: unknown[]) => unknown;

const PRIMITIVE_TYPES = new Set<Constructable>([String, Boolean, Number, Array, Object]);

// Exported for unit testing. Not re-exported from the package entrypoint
// (index.ts), so these remain internal to the package's public API.
export function mapViolations(errors: ValidationError[]): ViolationEntry[] {
  return errors.map((err) => {
    const value: unknown = err.value;
    return {
      property: err.property,
      value,
      constraints: err.constraints ?? {},
      children: err.children?.length ? mapViolations(err.children) : undefined,
    };
  });
}

export function countViolations(violations: ViolationEntry[]): number {
  return violations.reduce((acc, v) => {
    const childCount = v.children ? countViolations(v.children) : 0;
    return acc + (Object.keys(v.constraints).length || (v.children?.length ? 0 : 1)) + childCount;
  }, 0);
}

@Injectable()
export class ProfilerValidationPipe extends ValidationPipe {
  constructor(
    private readonly cls: ClsService,
    @Optional() @Inject(PROFILER_VALIDATION_OPTIONS) options: ValidationPipeOptions = {},
  ) {
    super(options);
  }

  /**
   * Overrides class-validator's validate() — lowest-level hook before errors
   * are converted to strings by exceptionFactory. Stores the raw ValidationError[]
   * in CLS (per-request, concurrent-safe) for capture in transform().
   */
  override async validate(
    object: object,
    validatorOptions?: ValidatorOptions,
  ): Promise<ValidationError[]> {
    const result = super.validate(object, validatorOptions);
    const errors = await Promise.resolve(result);
    if (errors.length > 0) {
      try {
        this.cls.set(VALIDATOR_PENDING_KEY, errors);
      } catch {
        // Outside CLS context
      }
    }
    return errors;
  }

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const startedAt = Date.now();
    const shouldCapture = this.shouldCaptureMetadata(metadata);

    try {
      const result: unknown = await super.transform(value, metadata);

      if (shouldCapture) {
        this.pushEntry({
          source: metadata.type,
          dtoClass: metadata.metatype?.name ?? 'unknown',
          status: 'valid',
          violationCount: 0,
          violations: [],
          timestamp: startedAt,
        });
      }

      return result;
    } catch (err) {
      if (shouldCapture) {
        let violations: ViolationEntry[] = [];
        try {
          const raw = this.cls.get<ValidationError[] | undefined>(VALIDATOR_PENDING_KEY) ?? [];
          this.cls.set(VALIDATOR_PENDING_KEY, undefined);
          violations = mapViolations(raw);
        } catch {
          // CLS unavailable
        }

        this.pushEntry({
          source: metadata.type,
          dtoClass: metadata.metatype?.name ?? 'unknown',
          status: 'invalid',
          violationCount: countViolations(violations),
          violations,
          timestamp: startedAt,
        });
      }
      throw err;
    }
  }

  private shouldCaptureMetadata(metadata: ArgumentMetadata): boolean {
    const { metatype } = metadata;
    return !!metatype && !PRIMITIVE_TYPES.has(metatype as Constructable);
  }

  private pushEntry(entry: ValidationEntry): void {
    try {
      const profile = this.cls.get<Profile | undefined>('profiler.profile');
      if (!profile) return;
      appendCollectorEntry<ValidationEntry>(profile, VALIDATOR_KEY, entry);
    } catch {
      // Outside CLS context
    }
  }
}
