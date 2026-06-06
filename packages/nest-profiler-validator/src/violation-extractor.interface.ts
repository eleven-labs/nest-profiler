import type { ViolationEntry } from './validator-collector.interface';

/**
 * Context handed to a {@link ValidationViolationExtractor}. Carries the error
 * thrown by the wrapped validation pipe. Kept intentionally minimal — the pipe
 * already knows the request source and DTO class from `ArgumentMetadata`.
 */
export interface ViolationExtractorContext {
  /** The error thrown by the inner validation pipe. */
  error: unknown;
}

/**
 * Pluggable strategy that turns a validator-specific error into the profiler's
 * neutral {@link ViolationEntry} shape. Built-in extractors duck-type known
 * error formats (class-validator, zod) without importing those packages, so the
 * collector stays agnostic to whichever validator the host application uses.
 *
 * Return `null` when the error is not recognized, so the next extractor in the
 * chain gets a chance.
 */
export interface ValidationViolationExtractor {
  extract(context: ViolationExtractorContext): ViolationEntry[] | null;
}

/**
 * Property key under which {@link createClassValidatorPipe} attaches the raw
 * `class-validator` `ValidationError[]` onto the thrown exception, so the
 * class-validator extractor can recover the full property/constraint tree that
 * the default NestJS `BadRequestException` flattens into plain strings.
 *
 * A unique (non-registered) symbol — never `Symbol.for` — so it cannot collide
 * with host-application keys and stays private to this package.
 */
export const VALIDATOR_RAW_ERRORS = Symbol('profiler.validator.rawErrors');
