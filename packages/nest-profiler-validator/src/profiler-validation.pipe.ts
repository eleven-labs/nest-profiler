import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry } from '@eleven-labs/nest-profiler';
import type { ValidationEntry, ViolationEntry } from './validator-collector.interface';
import {
  VALIDATOR_KEY,
  PROFILER_INNER_PIPE,
  PROFILER_EXTRACTORS,
} from './validator-collector.interface';
import type { ValidationViolationExtractor } from './violation-extractor.interface';
import { DEFAULT_EXTRACTORS } from './default-extractors';
import { countViolations } from './violation.utils';

type Constructable = abstract new (...args: unknown[]) => unknown;

const PRIMITIVE_TYPES = new Set<Constructable>([String, Boolean, Number, Array, Object]);

const PROFILE_KEY = 'profiler.profile';

/**
 * Wraps any validation `PipeTransform` (class-validator's `ValidationPipe`,
 * nestjs-zod's `ZodValidationPipe`, …) and records each validation outcome on
 * the active profile. Validator-agnostic: it never inspects the validator
 * directly — on failure it runs a chain of {@link ValidationViolationExtractor}s
 * over the thrown error to normalize violations.
 */
@Injectable()
export class ProfilerValidationPipe implements PipeTransform {
  constructor(
    private readonly cls: ClsService,
    @Inject(PROFILER_INNER_PIPE) private readonly inner: PipeTransform,
    @Optional()
    @Inject(PROFILER_EXTRACTORS)
    private readonly extractors: readonly ValidationViolationExtractor[] = DEFAULT_EXTRACTORS,
  ) {}

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const startedAt = Date.now();
    const capture = this.shouldCaptureMetadata(metadata);

    try {
      const result: unknown = await this.inner.transform(value, metadata);
      if (capture) this.recordValid(metadata, startedAt);
      return result;
    } catch (err) {
      if (capture) this.recordInvalid(metadata, startedAt, this.runExtractors(err));
      throw err;
    }
  }

  private runExtractors(error: unknown): ViolationEntry[] {
    for (const extractor of this.extractors) {
      const violations = extractor.extract({ error });
      if (violations) return violations;
    }
    return [];
  }

  private shouldCaptureMetadata(metadata: ArgumentMetadata): boolean {
    const { metatype } = metadata;
    return !!metatype && !PRIMITIVE_TYPES.has(metatype as Constructable);
  }

  private recordValid(metadata: ArgumentMetadata, timestamp: number): void {
    this.pushEntry({
      source: metadata.type,
      dtoClass: metadata.metatype?.name ?? 'unknown',
      status: 'valid',
      violationCount: 0,
      violations: [],
      timestamp,
    });
  }

  private recordInvalid(
    metadata: ArgumentMetadata,
    timestamp: number,
    violations: ViolationEntry[],
  ): void {
    this.pushEntry({
      source: metadata.type,
      dtoClass: metadata.metatype?.name ?? 'unknown',
      status: 'invalid',
      violationCount: countViolations(violations),
      violations,
      timestamp,
    });
  }

  private pushEntry(entry: ValidationEntry): void {
    try {
      const profile = this.cls.get<Profile | undefined>(PROFILE_KEY);
      if (!profile) return;
      appendCollectorEntry<ValidationEntry>(profile, VALIDATOR_KEY, entry);
    } catch {
      // Outside CLS context
    }
  }
}
