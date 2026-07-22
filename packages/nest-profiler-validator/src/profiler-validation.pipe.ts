import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import type { ClsService } from 'nestjs-cls';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry, lifecycleMarks, nowMs } from '@eleven-labs/nest-profiler';
import type { ValidationEntry, ViolationEntry } from './validator-collector.interface';
import { VALIDATOR_KEY } from './validator-collector.interface';
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
 *
 * CLS is resolved statically (no DI), so build it with {@link createProfilerValidationPipe}
 * for `app.useGlobalPipes(...)`. With no active profile it is a transparent pass-through.
 */
export class ProfilerValidationPipe implements PipeTransform {
  /** Process-wide CLS singleton — the same instance the core's `ClsModule` provides, so the pipe reads the store the profiler writes. */
  private readonly cls: ClsService = ClsServiceManager.getClsService();

  constructor(
    private readonly inner: PipeTransform,
    private readonly extractors: readonly ValidationViolationExtractor[] = DEFAULT_EXTRACTORS,
  ) {}

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const startedAt = nowMs();
    const capture = this.shouldCaptureMetadata(metadata);

    try {
      const result: unknown = await this.inner.transform(value, metadata);
      if (capture) this.recordValid(metadata, startedAt);
      return result;
    } catch (err) {
      // Recording must never replace the validation error (a 400) with a 500: isolate the
      // whole extraction so a throwing custom extractor can't propagate in place of `err`.
      if (capture) {
        try {
          this.recordInvalid(metadata, startedAt, this.runExtractors(err));
        } catch {
          // extractor/record failure — swallow; the original validation error still throws below
        }
      }
      throw err;
    }
  }

  private runExtractors(error: unknown): ViolationEntry[] {
    for (const extractor of this.extractors) {
      try {
        const violations = extractor.extract({ error });
        if (violations) return violations;
      } catch {
        // A custom extractor threw — skip it and try the next one.
      }
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
      // Widen the request's aggregate `validation` lifecycle window (the pipe runs once per
      // validated argument); buildLifecycle turns it into a single bar.
      const marks = lifecycleMarks(profile);
      marks.validationStart = Math.min(marks.validationStart ?? entry.timestamp, entry.timestamp);
      marks.validationEnd = Math.max(marks.validationEnd ?? nowMs(), nowMs());
    } catch {
      // Outside CLS context
    }
  }
}

/**
 * Builds a {@link ProfilerValidationPipe} for `app.useGlobalPipes(...)`, so the app owns
 * its validation pipe. Pair it with `ValidatorCollectorModule.forRoot()` (the panel) to gate
 * the profiler independently of validation.
 *
 * @param inner - the validation pipe to wrap (e.g. `new ValidationPipe()`, `new ZodValidationPipe()`)
 * @param extractors - violation extractor chain; defaults to {@link DEFAULT_EXTRACTORS}
 */
export const createProfilerValidationPipe = (
  inner: PipeTransform,
  extractors: readonly ValidationViolationExtractor[] = DEFAULT_EXTRACTORS,
): ProfilerValidationPipe => new ProfilerValidationPipe(inner, extractors);
